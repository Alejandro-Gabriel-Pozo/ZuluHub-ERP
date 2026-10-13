import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { emailDesdeTexto } from "../../../modulos/identidad/publico";
import { cuitDesdeTexto } from "../../../primitivas/identificacion-fiscal/cuit";
import "../../../../test/propiedades/configuracion";
import { CLAVES_DE_ATRIBUCION, normalizarAtribucion } from "./atribucion";
import { CLAVES_DE_AUDITORIA, clavesNoPermitidas } from "./auditoria";
import { pistaDeBot } from "./bot";
import { CODIGOS_DE_PROVINCIA, RUBROS, type VersionesVigentes } from "./catalogos";
import { decidirEnvio, MAXIMO_DE_ENVIOS, type SolicitudAbierta } from "./envio";
import {
  ESTADOS_DE_SOLICITUD,
  TRANSICIONES_DE_SOLICITUD,
  esTerminal,
  transicionPermitida,
} from "./estados";
import { validarFormulario, type EntradaDeFormulario } from "./formulario";
import {
  DURACION_DE_VENTANA_EN_MS,
  decidirLimite,
  inicioDeVentana,
  reglasDeLimite,
  type VentanaDeLimite,
} from "./limites";
import {
  PLAZO_PARA_VERIFICAR_EN_MS,
  RETENCION_DE_CERRADAS_EN_MS,
  debeAnonimizarse,
  vencidaSinVerificar,
} from "./retencion";

const VIGENTES: VersionesVigentes = {
  terminos: ["2026-10-13"],
  privacidad: ["2026-10-13.1"],
  avisoDeMedicion: ["2026-11-01"],
};

// Rango de fechas cómodo (1970 a 2100), con holgura para sumar los plazos más largos.
const instante = fc.integer({ min: 0, max: 4_102_444_800_000 }).map((ms) => new Date(ms));

// ---- formulario --------------------------------------------------------------------------------

/** Texto de todo tipo: ASCII, gráfemas, y unidades binarias (con sustitutos sueltos y controles). */
const texto = fc.oneof(
  fc.string({ unit: "grapheme-ascii", maxLength: 60 }),
  fc.string({ unit: "grapheme", maxLength: 60 }),
  fc.string({ unit: "binary", maxLength: 60 }),
  fc.constantFrom("Ana Pérez", "  Café   Central ", "Ñandú\u00a0S.A.", "a\nb", "\u202eAna", ""),
);

/** Mayormente válido (para que se acepten formularios enteros), con algo de basura. */
const casiSiempre = <T>(valido: fc.Arbitrary<T>, cualquiera: fc.Arbitrary<T>): fc.Arbitrary<T> =>
  fc.oneof({ weight: 6, arbitrary: valido }, { weight: 1, arbitrary: cualquiera });

const nombre = casiSiempre(
  fc.stringMatching(/^ ?[A-Za-zÁÉÍÓÚáéíóúñÑ]{1,12}( {1,3}[A-Za-zñ]{1,12}){0,3} ?$/),
  texto,
);

const correo = casiSiempre(
  fc
    .tuple(
      fc.stringMatching(/^[a-z0-9]{1,10}([._+-][a-z0-9]{1,10}){0,2}$/),
      fc.stringMatching(/^[a-z0-9]{1,10}(-[a-z0-9]{1,8}){0,2}$/),
      fc.constantFrom("com", "com.ar", "org", "COM.AR", "ar"),
    )
    .map(([l, d, t]) => `${l}@${d}.${t}`),
  fc.oneof(
    fc.emailAddress(),
    fc.emailAddress().map((c) => `  ${c.toUpperCase()}\t`),
    texto,
    fc.constantFrom("ana@cafe.com.ar", "a@b.co", "ana+x@gmail.com", "A@B.C"),
  ),
);

const telefono = casiSiempre(
  fc.oneof(
    fc.constant(""),
    fc.stringMatching(/^\+?[0-9]{2,4}[ .-]?[0-9]{4,5}[ -]?[0-9]{4}$/),
    fc.constantFrom("+54 9 11 1234-5678", "011 4444-5555", "(011) 4444.5555"),
  ),
  fc.oneof(
    fc.string({ unit: "grapheme-ascii", maxLength: 24 }),
    fc.stringMatching(/^[+(]?[0-9 ().-]{6,22}$/),
  ),
);

const cuit = casiSiempre(
  fc.constantFrom("", "30-70308853-4", "30703088534", " 20-12345678-6 "),
  fc.oneof(texto, fc.stringMatching(/^[0-9]{2}-?[0-9]{8}-?[0-9]$/)),
);

const provincia = casiSiempre(fc.constantFrom("", ...CODIGOS_DE_PROVINCIA), texto);
const rubro = casiSiempre(fc.constantFrom(...RUBROS), texto);
const idDeMedicion = casiSiempre(
  fc.oneof(
    fc.uuid(),
    fc.uuid().map((u) => u.toUpperCase()),
  ),
  texto,
);

const entrada: fc.Arbitrary<EntradaDeFormulario> = fc.record({
  nombreContacto: nombre,
  correo,
  nombreNegocio: nombre,
  rubro,
  provincia,
  telefono,
  cuit,
  aceptaTerminosYPrivacidad: fc.oneof(
    { weight: 6, arbitrary: fc.constant(true) },
    { weight: 1, arbitrary: fc.constant(false) },
  ),
  versionDeTerminos: casiSiempre(fc.constant("2026-10-13"), texto),
  versionDePrivacidad: casiSiempre(fc.constant("2026-10-13.1"), texto),
  medicionConsentida: fc.boolean(),
  versionDeAvisoDeMedicion: casiSiempre(fc.constant("2026-11-01"), texto),
  idDeMedicion,
  atribucion: fc.dictionary(
    fc.oneof(fc.constantFrom(...CLAVES_DE_ATRIBUCION, "otra"), texto),
    texto,
    { maxKeys: 6 },
  ),
});

const SIN_BORDES_EN_BLANCO = /^\S(.*\S)?$/su;
const PROHIBIDO = /[\p{C}\p{Zl}\p{Zp}]/u;

describe("propiedades de validarFormulario", () => {
  it("nunca lanza, y lo que acepta tiene la forma que exige la base y que identidad acepta", () => {
    let aceptadas = 0;
    fc.assert(
      fc.property(entrada, (e) => {
        const r = validarFormulario(e, VIGENTES);
        if (!r.ok) return;
        aceptadas += 1;
        const v = r.valor;
        for (const [nombre, maximo] of [
          [v.nombreContacto, 80],
          [v.nombreNegocio, 100],
        ] as const) {
          expect(nombre).toMatch(SIN_BORDES_EN_BLANCO);
          expect(PROHIBIDO.test(nombre)).toBe(false);
          expect([...nombre].length).toBeLessThanOrEqual(maximo);
          expect(nombre).toBe(nombre.normalize("NFC"));
        }
        // el correo: el CHECK de la base, y la regla de identidad (la invitación del gerente no falla por él)
        expect(v.correo).toBe(v.correo.toLowerCase());
        expect(v.correo.length).toBeLessThanOrEqual(254);
        expect(v.correo).toMatch(/^.+@.+$/);
        expect(v.correo).toMatch(/^[!-~]+$/);
        expect(emailDesdeTexto(v.correo)).toEqual({ ok: true, valor: v.correo });
        if (v.telefono !== null) expect(v.telefono).toMatch(/^\+?[0-9]{8,15}$/);
        if (v.cuit !== null) {
          expect(v.cuit).toMatch(/^[0-9]{11}$/);
          expect(cuitDesdeTexto(v.cuit).ok).toBe(true);
        }
        if (v.provincia !== null) expect(CODIGOS_DE_PROVINCIA).toContain(v.provincia);
        expect(RUBROS).toContain(v.rubro);
        // medición: sin consentimiento no queda nada que la identifique (solicitud_medicion_ck)
        expect(v.medicionConsentida).toBe(v.versionDeAvisoDeMedicion !== null);
        if (!v.medicionConsentida) {
          expect(v.idDeMedicion).toBeNull();
          expect(v.atribucion).not.toHaveProperty("fbclid");
        }
        if (v.idDeMedicion !== null) expect(v.idDeMedicion).toMatch(/^[0-9a-f-]{36}$/);
      }),
    );
    expect(aceptadas).toBeGreaterThan(20);
  });

  it("lo que acepta, vuelto a enviar, se acepta igual (la normalización es un punto fijo)", () => {
    fc.assert(
      fc.property(entrada, (e) => {
        const r = validarFormulario(e, VIGENTES);
        if (!r.ok) return;
        const v = r.valor;
        const otra = validarFormulario(
          {
            nombreContacto: v.nombreContacto,
            correo: v.correo,
            nombreNegocio: v.nombreNegocio,
            rubro: v.rubro,
            provincia: v.provincia ?? "",
            telefono: v.telefono ?? "",
            cuit: v.cuit ?? "",
            aceptaTerminosYPrivacidad: true,
            versionDeTerminos: v.versionDeTerminos,
            versionDePrivacidad: v.versionDePrivacidad,
            medicionConsentida: v.medicionConsentida,
            versionDeAvisoDeMedicion: v.versionDeAvisoDeMedicion ?? "",
            idDeMedicion: v.idDeMedicion ?? "",
            atribucion: v.atribucion,
          },
          VIGENTES,
        );
        expect(otra).toEqual(r);
      }),
    );
  });

  it("con una página vieja (versión fuera de la lista) siempre es PAGINA_VENCIDA, digan lo que digan los campos", () => {
    fc.assert(
      fc.property(entrada, fc.constantFrom("terminos", "privacidad"), (e, cual) => {
        const vieja = {
          ...e,
          ...(cual === "terminos"
            ? { versionDeTerminos: "1999-01-01" }
            : { versionDePrivacidad: "1999-01-01" }),
        };
        expect(validarFormulario(vieja, VIGENTES)).toEqual({
          ok: false,
          error: { tipo: "PAGINA_VENCIDA" },
        });
      }),
    );
  });

  it("FORMA_INVALIDA lista campos sin repetir, en el orden del formulario, y nunca vacía", () => {
    const orden = [
      "nombreContacto",
      "correo",
      "nombreNegocio",
      "rubro",
      "provincia",
      "telefono",
      "cuit",
      "aceptaTerminosYPrivacidad",
    ];
    fc.assert(
      fc.property(entrada, (e) => {
        const r = validarFormulario(
          {
            ...e,
            versionDeTerminos: "2026-10-13",
            versionDePrivacidad: "2026-10-13.1",
            medicionConsentida: false,
          },
          VIGENTES,
        );
        if (r.ok || r.error.tipo !== "FORMA_INVALIDA") return;
        expect(r.error.campos.length).toBeGreaterThan(0);
        expect(new Set(r.error.campos).size).toBe(r.error.campos.length);
        const posiciones = r.error.campos.map((c) => orden.indexOf(c));
        expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
      }),
    );
  });
});

describe("propiedades de normalizarAtribucion", () => {
  const crudo = fc.dictionary(
    fc.oneof(fc.constantFrom(...CLAVES_DE_ATRIBUCION, "otra"), texto),
    fc.oneof(texto, fc.constant(undefined)),
    { maxKeys: 8 },
  );

  it("solo claves de la lista y en su orden, con valores de la forma que exige la base", () => {
    fc.assert(
      fc.property(crudo, fc.boolean(), (c, consentimiento) => {
        const r = normalizarAtribucion(c, consentimiento);
        const claves = Object.keys(r);
        const posiciones = claves.map((k) =>
          (CLAVES_DE_ATRIBUCION as readonly string[]).indexOf(k),
        );
        expect(posiciones.every((p) => p >= 0)).toBe(true);
        expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
        for (const valor of Object.values(r)) expect(valor).toMatch(/^[A-Za-z0-9._~-]{1,200}$/);
        if (!consentimiento) expect(claves).not.toContain("fbclid");
      }),
    );
  });

  it("es un punto fijo: normalizar lo ya normalizado no cambia nada", () => {
    fc.assert(
      fc.property(crudo, fc.boolean(), (c, consentimiento) => {
        const una = normalizarAtribucion(c, consentimiento);
        expect(normalizarAtribucion(una, consentimiento)).toEqual(una);
      }),
    );
  });
});

describe("propiedades de decidirEnvio", () => {
  const abierta: fc.Arbitrary<SolicitudAbierta> = fc.record({
    estado: fc.constantFrom("NUEVA", "VERIFICADA", "APROBADA"),
    numeroDeEnvios: fc.integer({ min: 1, max: 8 }),
    ultimoEnvioEn: instante,
  });

  it("solo reenvía una NUEVA con menos de 5 envíos y pasados los 2 minutos, con el número siguiente", () => {
    fc.assert(
      fc.property(abierta, instante, (a, ahora) => {
        const d = decidirEnvio(a, null, ahora);
        if (d.tipo === "REENVIAR") {
          expect(a.estado).toBe("NUEVA");
          expect(a.numeroDeEnvios).toBeLessThan(MAXIMO_DE_ENVIOS);
          expect(d.numero).toBe(a.numeroDeEnvios + 1);
          expect(d.numero).toBeLessThanOrEqual(MAXIMO_DE_ENVIOS);
          expect(ahora.getTime() - a.ultimoEnvioEn.getTime()).toBeGreaterThanOrEqual(120_000);
        }
        expect(d.tipo).not.toBe("CREAR");
      }),
    );
  });

  it("si puede reenviar ahora, puede reenviar en cualquier momento posterior (esperar no empeora)", () => {
    fc.assert(
      fc.property(
        abierta,
        instante,
        fc.integer({ min: 0, max: 10_000_000 }),
        (a, ahora, despues) => {
          if (decidirEnvio(a, null, ahora).tipo !== "REENVIAR") return;
          expect(decidirEnvio(a, null, new Date(ahora.getTime() + despues)).tipo).toBe("REENVIAR");
        },
      ),
    );
  });

  it("sin abierta, solo se frena por un spam de menos de 90 días: crear es lo normal", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("ALTA_CREADA", "RECHAZADA", "SPAM"),
        instante,
        instante,
        (estado, decididaEn, ahora) => {
          const d = decidirEnvio(null, { estado, decididaEn }, ahora);
          const bloqueado =
            estado === "SPAM" &&
            ahora.getTime() - decididaEn.getTime() < RETENCION_DE_CERRADAS_EN_MS;
          expect(d).toEqual(
            bloqueado ? { tipo: "NADA", motivo: "SPAM_RECIENTE" } : { tipo: "CREAR" },
          );
        },
      ),
    );
  });
});

describe("propiedades de los límites", () => {
  const reglas = reglasDeLimite({ topeGlobalDeVerificacionesPorDia: 50 });
  const observaciones = fc.array(
    fc.record({
      regla: fc.constantFrom(...reglas),
      cuenta: fc.integer({ min: 1, max: 120 }),
    }),
    { maxLength: 8 },
  );

  it("pasa si y solo si ninguna cuenta supera su tope; si no, la capa señalada es de una que se pasó", () => {
    fc.assert(
      fc.property(observaciones, (obs) => {
        const excedidas = obs.filter((o) => o.cuenta > o.regla.tope);
        const d = decidirLimite(obs);
        expect(d.tipo === "PERMITIDO").toBe(excedidas.length === 0);
        if (d.tipo === "EXCEDIDO") {
          expect(excedidas.map((o) => o.regla.capa)).toContain(d.capa);
          expect(d.visible).toBe(excedidas.some((o) => o.regla.alPasar === "VISIBLE"));
        }
      }),
    );
  });

  it("el orden de las observaciones no cambia si pasa o no pasa, ni si se ve", () => {
    fc.assert(
      fc.property(observaciones, (obs) => {
        const a = decidirLimite(obs);
        const b = decidirLimite([...obs].reverse());
        expect(b.tipo).toBe(a.tipo);
        if (a.tipo === "EXCEDIDO" && b.tipo === "EXCEDIDO") expect(b.visible).toBe(a.visible);
      }),
    );
  });

  it("una ventana contiene a ahora, empieza alineada, y su inicio es un punto fijo", () => {
    fc.assert(
      fc.property(
        instante,
        fc.constantFrom<VentanaDeLimite>("HORA", "DIA", "SEMANA"),
        (ahora, ventana) => {
          const inicio = inicioDeVentana(ventana, ahora);
          expect(inicio.getTime()).toBeLessThanOrEqual(ahora.getTime());
          expect(ahora.getTime()).toBeLessThan(
            inicio.getTime() + DURACION_DE_VENTANA_EN_MS[ventana],
          );
          expect(inicioDeVentana(ventana, inicio).getTime()).toBe(inicio.getTime());
          expect(
            inicio.getUTCMinutes() + inicio.getUTCSeconds() + inicio.getUTCMilliseconds(),
          ).toBe(0);
          if (ventana !== "HORA") expect(inicio.getUTCHours()).toBe(0);
          if (ventana === "SEMANA") expect(inicio.getUTCDay()).toBe(1);
        },
      ),
    );
  });
});

describe("propiedades del anti-bots, la retención, los estados y la auditoría", () => {
  it("pistaDeBot: con el campo invisible vacío, solo el tiempo decide y en tramos", () => {
    fc.assert(
      fc.property(instante, fc.integer({ min: -200_000_000, max: 200_000_000 }), (ahora, delta) => {
        const r = pistaDeBot("", new Date(ahora.getTime() - delta), ahora);
        expect(r).toBe(
          delta < 2000 ? "BOT_TIEMPO_MINIMO" : delta > 86_400_000 ? "PAGINA_VENCIDA" : "HUMANO",
        );
      }),
    );
  });

  it("pistaDeBot: con algo en el campo invisible es siempre BOT_HONEYPOT", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }),
        instante,
        instante,
        (h, emitido, ahora) => {
          expect(pistaDeBot(h, emitido, ahora)).toBe("BOT_HONEYPOT");
        },
      ),
    );
  });

  it("vencer y anonimizar son monótonos: una vez que toca, sigue tocando", () => {
    fc.assert(
      fc.property(
        instante,
        instante,
        fc.integer({ min: 0, max: 1_000_000_000_000 }),
        fc.constantFrom(...ESTADOS_DE_SOLICITUD),
        (creadaEn, ahora, despues, estado) => {
          const luego = new Date(ahora.getTime() + despues);
          if (vencidaSinVerificar({ estado, creadaEn }, ahora)) {
            expect(vencidaSinVerificar({ estado, creadaEn }, luego)).toBe(true);
          }
          const s = { estado, decididaEn: creadaEn, anonimizadaEn: null };
          if (debeAnonimizarse(s, ahora)) expect(debeAnonimizarse(s, luego)).toBe(true);
        },
      ),
    );
  });

  it("los plazos separan: vencer es solo de NUEVA y anonimizar solo de las cerradas, nunca las dos a la vez", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ESTADOS_DE_SOLICITUD), instante, (estado, t) => {
        const ahora = new Date(
          t.getTime() + Math.max(PLAZO_PARA_VERIFICAR_EN_MS, RETENCION_DE_CERRADAS_EN_MS),
        );
        const vence = vencidaSinVerificar({ estado, creadaEn: t }, ahora);
        const anonimiza = debeAnonimizarse({ estado, decididaEn: t, anonimizadaEn: null }, ahora);
        expect(vence && anonimiza).toBe(false);
        expect(vence).toBe(estado === "NUEVA");
        expect(anonimiza).toBe(esTerminal(estado));
      }),
    );
  });

  it("transicionPermitida implica que el destino figura en la tabla y que el origen no es terminal", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ESTADOS_DE_SOLICITUD),
        fc.constantFrom(...ESTADOS_DE_SOLICITUD),
        fc.constantFrom("CAPTACION", "ADMIN", "SISTEMA"),
        (desde, hasta, actor) => {
          if (!transicionPermitida(desde, hasta, actor)) return;
          expect(TRANSICIONES_DE_SOLICITUD[desde]).toContain(hasta);
          expect(esTerminal(desde)).toBe(false);
        },
      ),
    );
  });

  it("auditoría: cualquier dato con claves de la lista y valores seguros pasa; una clave de más siempre se señala", () => {
    const seguro = fc.oneof(
      fc.stringMatching(/^[A-Za-z0-9._~:-]{1,200}$/),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
    );
    const permitidos = fc.dictionary(fc.constantFrom(...CLAVES_DE_AUDITORIA), seguro);
    fc.assert(
      fc.property(
        permitidos,
        fc.constantFrom("email", "nombre", "telefono", "cuit", "x"),
        (datos, extra) => {
          expect(clavesNoPermitidas(datos)).toEqual([]);
          expect(clavesNoPermitidas({ ...datos, [extra]: "valor" })).toEqual([extra]);
        },
      ),
    );
  });
});

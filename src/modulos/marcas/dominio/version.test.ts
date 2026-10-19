import { describe, expect, it } from "vitest";
import { planId } from "../../../primitivas/identificadores/marca";
import { ASPECTO_POR_DEFECTO } from "./aspecto";
import { DEFINICION_VACIA, type DefinicionDeMarca } from "./definicion";
import {
  decidirConfirmacionDeMarca,
  decidirGuardadoDeBorrador,
  validarCambiosDeBorrador,
  type PlanPorDefecto,
} from "./version";

const PLAN_A = planId("plan-a");
const PLAN_B = planId("plan-b");

const CATALOGO_DE_MODULOS = {
  administracion: { estado: "disponible", obligatorio: true },
  reservas: { estado: "disponible", obligatorio: false },
  stock: { estado: "disponible", obligatorio: false },
  comandas: { estado: "en_desarrollo", obligatorio: false },
} as const;

describe("validarCambiosDeBorrador", () => {
  const validar = (cambios: Parameters<typeof validarCambiosDeBorrador>[0]) =>
    validarCambiosDeBorrador(cambios, CATALOGO_DE_MODULOS);

  it("sin cambios, no hay nada que aplicar: los campos ausentes siguen ausentes", () => {
    const r = validar({});
    expect(r).toEqual({ ok: true, valor: {} });
    expect(r.ok && Object.keys(r.valor)).toEqual([]);
  });

  it("valida cada campo presente y lo deja en forma canónica", () => {
    expect(
      validar({
        nombreVisible: "  Mi Calendario ",
        tema: { accent: "#00ff7f" },
        aspecto: { titulos: "SERIF", estilo: "LUDICO" },
        logo: "/marcas/mc/logo.png",
        vocabulario: { "rol.gerente.nombre": " Encargado " },
        modulosIniciales: ["stock", "reservas", "stock"],
        planPorDefectoId: PLAN_A,
      }),
    ).toEqual({
      ok: true,
      valor: {
        nombreVisible: "Mi Calendario",
        tema: { accent: "#00ff7f" },
        aspecto: { estilo: "LUDICO", titulos: "SERIF" },
        logo: "/marcas/mc/logo.png",
        vocabulario: { "rol.gerente.nombre": "Encargado" },
        modulosIniciales: ["stock", "reservas"],
        planPorDefectoId: PLAN_A,
      },
    });
  });

  it("null vacía el campo (vuelve a heredar) y se conserva distinto de ausente", () => {
    const r = validar({
      nombreVisible: null,
      logo: null,
      modulosIniciales: null,
      planPorDefectoId: null,
    });
    expect(r).toEqual({
      ok: true,
      valor: { nombreVisible: null, logo: null, modulosIniciales: null, planPorDefectoId: null },
    });
  });

  it("un tema, un aspecto y un vocabulario vacíos son cambios válidos (borran todo lo propio)", () => {
    expect(validar({ tema: {}, aspecto: {}, vocabulario: {}, modulosIniciales: [] })).toEqual({
      ok: true,
      valor: { tema: {}, aspecto: {}, vocabulario: {}, modulosIniciales: [] },
    });
  });

  it("el aspecto con una clave o un valor fuera de la lista cerrada se rechaza con la clave que lo trae", () => {
    expect(validar({ aspecto: { estilo: "moderno" } })).toEqual({
      ok: false,
      error: { codigo: "ASPECTO_INVALIDO", token: "estilo" },
    });
    expect(validar({ aspecto: { fondo: "NEUTRA" } })).toEqual({
      ok: false,
      error: { codigo: "ASPECTO_INVALIDO", token: "fondo" },
    });
    expect(validar({ aspecto: { ingreso: "MODERNO" } })).toEqual({
      ok: false,
      error: { codigo: "ASPECTO_INVALIDO", token: "ingreso" },
    });
  });

  it("cada campo con problema se informa con el error de su regla", () => {
    expect(validar({ nombreVisible: "<b>" })).toEqual({
      ok: false,
      error: "NOMBRE_DE_MARCA_INVALIDO",
    });
    expect(validar({ nombreVisible: "" })).toEqual({
      ok: false,
      error: "NOMBRE_DE_MARCA_INVALIDO",
    });
    expect(validar({ tema: { primary: "rojo" } })).toEqual({
      ok: false,
      error: { codigo: "TEMA_INVALIDO", token: "primary" },
    });
    expect(validar({ logo: "/marcas/mc/logo.svg" })).toEqual({ ok: false, error: "LOGO_INVALIDO" });
    expect(validar({ vocabulario: { "no.existe": "x" } })).toEqual({
      ok: false,
      error: { codigo: "CLAVE_DE_TEXTO_DESCONOCIDA", texto: "no.existe" },
    });
    expect(validar({ vocabulario: { "rol.gerente.nombre": "a<b" } })).toEqual({
      ok: false,
      error: {
        codigo: "TEXTO_INVALIDO",
        texto: "rol.gerente.nombre",
        motivo: "CARACTER_PROHIBIDO",
      },
    });
    expect(validar({ vocabulario: { "error.limite_del_plan": "sin marcador" } })).toEqual({
      ok: false,
      error: { codigo: "MARCADORES_DISTINTOS", texto: "error.limite_del_plan" },
    });
    expect(validar({ modulosIniciales: ["comandas"] })).toEqual({
      ok: false,
      error: { codigo: "MODULO_DESCONOCIDO", modulo: "comandas" },
    });
  });

  it("informa el primer problema en el orden: nombre, tema, aspecto, logo, vocabulario, módulos", () => {
    const todoMal = {
      nombreVisible: "<",
      tema: { primary: "x" },
      aspecto: { estilo: "x" },
      logo: "x",
      vocabulario: { "no.existe": "x" },
      modulosIniciales: ["x"],
    };
    // Cada vuelta quita el campo que acaba de fallar: el siguiente en el orden es el que se informa.
    const sin = (...campos: string[]) =>
      Object.fromEntries(Object.entries(todoMal).filter(([campo]) => !campos.includes(campo)));
    expect(validar(todoMal)).toEqual({ ok: false, error: "NOMBRE_DE_MARCA_INVALIDO" });
    expect(validar(sin("nombreVisible"))).toEqual({
      ok: false,
      error: { codigo: "TEMA_INVALIDO", token: "primary" },
    });
    expect(validar(sin("nombreVisible", "tema"))).toEqual({
      ok: false,
      error: { codigo: "ASPECTO_INVALIDO", token: "estilo" },
    });
    expect(validar(sin("nombreVisible", "tema", "aspecto"))).toEqual({
      ok: false,
      error: "LOGO_INVALIDO",
    });
    expect(validar(sin("nombreVisible", "tema", "aspecto", "logo"))).toEqual({
      ok: false,
      error: { codigo: "CLAVE_DE_TEXTO_DESCONOCIDA", texto: "no.existe" },
    });
    expect(validar(sin("nombreVisible", "tema", "aspecto", "logo", "vocabulario"))).toEqual({
      ok: false,
      error: { codigo: "MODULO_DESCONOCIDO", modulo: "x" },
    });
  });

  it("no modifica lo que recibe", () => {
    const cambios = { nombreVisible: "  A  ", modulosIniciales: ["stock", "stock"] };
    validar(cambios);
    expect(cambios).toEqual({ nombreVisible: "  A  ", modulosIniciales: ["stock", "stock"] });
  });
});

describe("decidirGuardadoDeBorrador", () => {
  const existente: DefinicionDeMarca = {
    nombreVisible: "Viejo",
    tema: { primary: "#111111", accent: "#222222" },
    aspecto: { estilo: "MODERNO", ingreso: "DIVIDIDO" },
    logo: "/marcas/mc/viejo.png",
    vocabulario: { "rol.gerente.nombre": "Jefe" },
    modulosIniciales: ["stock"],
    planPorDefectoId: PLAN_A,
  };

  it("sin borrador y sin versión esperada, nace uno nuevo partiendo de una definición vacía", () => {
    expect(decidirGuardadoDeBorrador(null, null, { nombreVisible: "Nuevo" })).toEqual({
      ok: true,
      valor: { esNuevo: true, definicion: { ...DEFINICION_VACIA, nombreVisible: "Nuevo" } },
    });
    expect(decidirGuardadoDeBorrador(null, null, {})).toEqual({
      ok: true,
      valor: { esNuevo: true, definicion: DEFINICION_VACIA },
    });
  });

  it("con borrador y la versión que se vio, se actualiza: lo ausente se conserva", () => {
    expect(decidirGuardadoDeBorrador({ definicion: existente, version: 3 }, 3, {})).toEqual({
      ok: true,
      valor: { esNuevo: false, definicion: existente },
    });
    expect(
      decidirGuardadoDeBorrador({ definicion: existente, version: 3 }, 3, {
        nombreVisible: "Nuevo",
      }),
    ).toEqual({
      ok: true,
      valor: { esNuevo: false, definicion: { ...existente, nombreVisible: "Nuevo" } },
    });
  });

  it("cada campo se cambia por separado, sin tocar los otros", () => {
    const guardado = { definicion: existente, version: 1 };
    const cambiado = (cambios: Parameters<typeof decidirGuardadoDeBorrador>[2]) => {
      const r = decidirGuardadoDeBorrador(guardado, 1, cambios);
      return r.ok ? r.valor.definicion : null;
    };
    expect(cambiado({ logo: "/marcas/mc/nuevo.webp" })).toEqual({
      ...existente,
      logo: "/marcas/mc/nuevo.webp",
    });
    expect(cambiado({ modulosIniciales: ["reservas"] })).toEqual({
      ...existente,
      modulosIniciales: ["reservas"],
    });
    expect(cambiado({ planPorDefectoId: PLAN_B })).toEqual({
      ...existente,
      planPorDefectoId: PLAN_B,
    });
    expect(cambiado({ tema: { primary: "#333333" } })).toEqual({
      ...existente,
      tema: { primary: "#333333" },
    });
    expect(cambiado({ vocabulario: { "rol.operador.nombre": "Mozo" } })).toEqual({
      ...existente,
      vocabulario: { "rol.operador.nombre": "Mozo" },
    });
    expect(cambiado({ aspecto: { esquinas: "RECTA" } })).toEqual({
      ...existente,
      aspecto: { esquinas: "RECTA" },
    });
  });

  it("null vacía el campo, [] y {} también (pero no es lo mismo que ausente)", () => {
    const guardado = { definicion: existente, version: 1 };
    const cambiado = (cambios: Parameters<typeof decidirGuardadoDeBorrador>[2]) => {
      const r = decidirGuardadoDeBorrador(guardado, 1, cambios);
      return r.ok ? r.valor.definicion : null;
    };
    expect(cambiado({ nombreVisible: null })?.nombreVisible).toBeNull();
    expect(cambiado({ logo: null })?.logo).toBeNull();
    expect(cambiado({ modulosIniciales: null })?.modulosIniciales).toBeNull();
    expect(cambiado({ modulosIniciales: [] })?.modulosIniciales).toEqual([]);
    expect(cambiado({ planPorDefectoId: null })?.planPorDefectoId).toBeNull();
    expect(cambiado({ tema: {} })?.tema).toEqual({});
    expect(cambiado({ aspecto: {} })?.aspecto).toEqual({});
    expect(cambiado({ vocabulario: {} })?.vocabulario).toEqual({});
  });

  it("el tema, el aspecto y el vocabulario se reemplazan enteros, no se mezclan", () => {
    const r = decidirGuardadoDeBorrador({ definicion: existente, version: 1 }, 1, {
      tema: { secondary: "#444444" },
      aspecto: { titulos: "SERIF" },
    });
    expect(r.ok && r.valor.definicion.tema).toEqual({ secondary: "#444444" });
    expect(r.ok && r.valor.definicion.aspecto).toEqual({ titulos: "SERIF" });
  });

  it("un borrador nuevo parte con el aspecto vacío (hereda) y guardar otro campo no lo toca", () => {
    const nuevo = decidirGuardadoDeBorrador(null, null, { nombreVisible: "Nuevo" });
    expect(nuevo.ok && nuevo.valor.definicion.aspecto).toEqual({});
    const otro = decidirGuardadoDeBorrador({ definicion: existente, version: 1 }, 1, {
      logo: "/marcas/mc/otro.png",
    });
    expect(otro.ok && otro.valor.definicion.aspecto).toEqual({
      estilo: "MODERNO",
      ingreso: "DIVIDIDO",
    });
  });

  it("si lo que el cliente vio no es lo que hay, VERSION_DESACTUALIZADA", () => {
    // Pensaba que no había borrador, pero hay uno.
    expect(decidirGuardadoDeBorrador({ definicion: existente, version: 1 }, null, {})).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    // Pensaba que había uno (versión 2), pero no hay ninguno.
    expect(decidirGuardadoDeBorrador(null, 2, {})).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    expect(decidirGuardadoDeBorrador(null, 0, {})).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    // Vio una versión vieja o una futura.
    expect(decidirGuardadoDeBorrador({ definicion: existente, version: 3 }, 2, {})).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    expect(decidirGuardadoDeBorrador({ definicion: existente, version: 3 }, 4, {})).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    expect(decidirGuardadoDeBorrador({ definicion: existente, version: 0 }, null, {}).ok).toBe(
      false,
    );
  });

  it("no modifica el borrador que recibe", () => {
    const copia = structuredClone(existente);
    decidirGuardadoDeBorrador({ definicion: existente, version: 1 }, 1, { nombreVisible: "Otro" });
    expect(existente).toEqual(copia);
  });
});

describe("decidirConfirmacionDeMarca", () => {
  const AHORA = new Date("2026-10-12T12:00:00.000Z");
  const enMs = (ms: number) => new Date(AHORA.getTime() + ms);
  const DIA = 86_400_000;

  const PRINCIPAL: DefinicionDeMarca = {
    nombreVisible: "ZuluHub",
    tema: {
      primary: "#1a73e8",
      "on-primary": "#ffffff",
      secondary: "#5f6368",
      accent: "#d93025",
    },
    aspecto: {},
    logo: "/marcas/zuluhub/logo.png",
    vocabulario: { "rol.gerente.nombre": "Gerente general" },
    modulosIniciales: ["reservas"],
    planPorDefectoId: PLAN_A,
  };
  const PLAN: PlanPorDefecto = { id: PLAN_A, retirado: false, modulos: ["reservas", "stock"] };

  const pedido = {
    vigenteDesde: enMs(DIA),
    motivo: "Primera versión",
    reemplazaProgramada: false,
  };

  type Entrada = Parameters<typeof decidirConfirmacionDeMarca>[0];
  const entrada = (cambios: Partial<Entrada> = {}): Entrada => ({
    borrador: PRINCIPAL,
    ancestros: [],
    versiones: [],
    planPorDefecto: PLAN,
    pedido,
    ahora: AHORA,
    ...cambios,
  });
  const error = (cambios: Partial<Entrada> = {}) => {
    const r = decidirConfirmacionDeMarca(entrada(cambios));
    return r.ok ? null : r.error;
  };

  it("la principal completa se confirma, con la vigencia pedida y el motivo recortado", () => {
    const r = decidirConfirmacionDeMarca(
      entrada({ pedido: { ...pedido, motivo: "  Primera versión  " } }),
    );
    expect(r).toEqual({
      ok: true,
      valor: {
        motivo: "Primera versión",
        vigenteDesde: pedido.vigenteDesde,
        definicion: { ...PRINCIPAL, aspecto: ASPECTO_POR_DEFECTO },
      },
    });
  });

  it("un producto que define solo el nombre se confirma con la herencia de la principal", () => {
    const producto = { ...DEFINICION_VACIA, nombreVisible: "Mi Calendario" };
    const r = decidirConfirmacionDeMarca(entrada({ borrador: producto, ancestros: [PRINCIPAL] }));
    expect(r).toEqual({
      ok: true,
      valor: {
        motivo: "Primera versión",
        vigenteDesde: pedido.vigenteDesde,
        definicion: {
          ...PRINCIPAL,
          nombreVisible: "Mi Calendario",
          aspecto: ASPECTO_POR_DEFECTO,
        },
      },
    });
  });

  it("el aspecto confirmado es el resuelto con la herencia y los defectos: el padre define el estilo, la hija solo las esquinas", () => {
    const padre = { ...PRINCIPAL, aspecto: { estilo: "MODERNO", superficie: "FRIA" } } as const;
    const hija = {
      ...DEFINICION_VACIA,
      nombreVisible: "Mi Calendario",
      aspecto: { esquinas: "REDONDEADA" },
    } as const;
    const r = decidirConfirmacionDeMarca(entrada({ borrador: hija, ancestros: [padre] }));
    expect(r.ok && r.valor.definicion.aspecto).toStrictEqual({
      estilo: "MODERNO",
      superficie: "FRIA",
      esquinas: "REDONDEADA",
      titulos: "SANS",
      ingreso: "CENTRADO",
    });
    // Sin ningún aspecto definido en la cadena, el aspecto confirmado son los defectos.
    const sola = decidirConfirmacionDeMarca(entrada({ borrador: PRINCIPAL }));
    expect(sola.ok && sola.valor.definicion.aspecto).toStrictEqual(ASPECTO_POR_DEFECTO);
  });

  it("la cadena puede tener padre y abuelo, y un ancestro sin versión vigente se saltea", () => {
    const padre = { ...DEFINICION_VACIA, tema: { primary: "#336699" } };
    const hijo = { ...DEFINICION_VACIA, nombreVisible: "Nieto" };
    const r = decidirConfirmacionDeMarca(
      entrada({ borrador: hijo, ancestros: [padre, PRINCIPAL] }),
    );
    expect(r.ok && r.valor.definicion.tema.primary).toBe("#336699");
    expect(r.ok && r.valor.definicion.logo).toBe("/marcas/zuluhub/logo.png");
    const s = decidirConfirmacionDeMarca(entrada({ borrador: hijo, ancestros: [null, PRINCIPAL] }));
    expect(s.ok && s.valor.definicion.tema.primary).toBe("#1a73e8");
  });

  describe("los errores, en el orden de la especificación", () => {
    it("SIN_BORRADOR gana a todo", () => {
      expect(
        error({
          borrador: null,
          pedido: { ...pedido, motivo: "", vigenteDesde: enMs(-DIA) },
          planPorDefecto: null,
        }),
      ).toEqual({ codigo: "SIN_BORRADOR" });
    });

    it("MOTIVO_OBLIGATORIO: vacío o en blanco", () => {
      expect(error({ pedido: { ...pedido, motivo: "" } })).toEqual({
        codigo: "MOTIVO_OBLIGATORIO",
      });
      expect(error({ pedido: { ...pedido, motivo: "  \n " } })).toEqual({
        codigo: "MOTIVO_OBLIGATORIO",
      });
      expect(error({ pedido: { ...pedido, motivo: "", vigenteDesde: enMs(-DIA) } })).toEqual({
        codigo: "MOTIVO_OBLIGATORIO",
      });
    });

    it("VIGENCIA_RETROACTIVA: tolera un minuto de reloj, ni un milisegundo más", () => {
      expect(error({ pedido: { ...pedido, vigenteDesde: enMs(-60_000) } })).toBeNull();
      expect(error({ pedido: { ...pedido, vigenteDesde: enMs(-60_001) } })).toEqual({
        codigo: "VIGENCIA_RETROACTIVA",
      });
      expect(error({ pedido: { ...pedido, vigenteDesde: enMs(-DIA) } })).toEqual({
        codigo: "VIGENCIA_RETROACTIVA",
      });
      expect(error({ pedido: { ...pedido, vigenteDesde: AHORA } })).toBeNull();
      expect(error({ pedido: { ...pedido, vigenteDesde: enMs(1) } })).toBeNull();
    });

    it("una fecha inválida cuenta como retroactiva", () => {
      expect(error({ pedido: { ...pedido, vigenteDesde: new Date(Number.NaN) } })).toEqual({
        codigo: "VIGENCIA_RETROACTIVA",
      });
    });

    it("CAMBIO_PROGRAMADO_PENDIENTE: con una programada, hay que pedir reemplazarla", () => {
      const versiones = [
        { numero: 1, vigenteDesde: enMs(-DIA) },
        { numero: 2, vigenteDesde: enMs(7 * DIA) },
      ];
      expect(error({ versiones })).toEqual({ codigo: "CAMBIO_PROGRAMADO_PENDIENTE" });
      expect(error({ versiones, pedido: { ...pedido, reemplazaProgramada: true } })).toBeNull();
    });

    it("una programada que ya quedó sin efecto no cuenta; una ya vigente tampoco", () => {
      expect(
        error({
          versiones: [
            { numero: 1, vigenteDesde: enMs(-3 * DIA) },
            { numero: 2, vigenteDesde: enMs(7 * DIA) },
            { numero: 3, vigenteDesde: enMs(-DIA) },
          ],
        }),
      ).toBeNull();
      expect(error({ versiones: [{ numero: 1, vigenteDesde: enMs(-DIA) }] })).toBeNull();
    });

    it("CAMBIO_PROGRAMADO_PENDIENTE se informa antes que una definición incompleta", () => {
      expect(
        error({
          borrador: DEFINICION_VACIA,
          versiones: [{ numero: 1, vigenteDesde: enMs(DIA) }],
        }),
      ).toEqual({ codigo: "CAMBIO_PROGRAMADO_PENDIENTE" });
    });

    it("VIGENCIA_RETROACTIVA se informa antes que CAMBIO_PROGRAMADO_PENDIENTE", () => {
      expect(
        error({
          pedido: { ...pedido, vigenteDesde: enMs(-DIA) },
          versiones: [{ numero: 1, vigenteDesde: enMs(DIA) }],
        }),
      ).toEqual({ codigo: "VIGENCIA_RETROACTIVA" });
    });

    it("DEFINICION_INCOMPLETA: la principal tiene que definir todo; nombra lo que falta", () => {
      expect(error({ borrador: { ...PRINCIPAL, logo: null, modulosIniciales: null } })).toEqual({
        codigo: "DEFINICION_INCOMPLETA",
        faltan: ["logo", "modulos_iniciales"],
      });
      expect(error({ borrador: DEFINICION_VACIA })).toEqual({
        codigo: "DEFINICION_INCOMPLETA",
        faltan: [
          "nombre_visible",
          "tema.primary",
          "tema.on-primary",
          "tema.secondary",
          "tema.accent",
          "logo",
          "modulos_iniciales",
          "plan_por_defecto",
        ],
      });
    });

    it("DEFINICION_INCOMPLETA: un producto sin nombre propio no se confirma aunque herede uno", () => {
      expect(error({ borrador: DEFINICION_VACIA, ancestros: [PRINCIPAL] })).toEqual({
        codigo: "DEFINICION_INCOMPLETA",
        faltan: ["nombre_visible"],
      });
    });

    it("una definición incompleta no necesita el plan: no se lanza", () => {
      expect(error({ borrador: DEFINICION_VACIA, planPorDefecto: null })).toMatchObject({
        codigo: "DEFINICION_INCOMPLETA",
      });
    });

    it("ASPECTO_INVALIDO: segunda barrera sobre el aspecto RESUELTO, con la clave que lo trae", () => {
      const malo = (aspecto: unknown): DefinicionDeMarca =>
        ({ ...PRINCIPAL, aspecto }) as unknown as DefinicionDeMarca;
      expect(error({ borrador: malo({ estilo: "moderno" }) })).toEqual({
        codigo: "ASPECTO_INVALIDO",
        token: "estilo",
      });
      // Una clave ajena no es de la lista: la herencia no la lleva a lo resuelto y no puede salir publicada.
      expect(error({ borrador: malo({ fondo: "NEUTRA" }) })).toBeNull();
      expect(error({ borrador: malo({ estilo: 7 }) })).toEqual({
        codigo: "ASPECTO_INVALIDO",
        token: "estilo",
      });
      // Un ancestro con un valor inválido que la hija hereda también frena la confirmación.
      const hija = { ...DEFINICION_VACIA, nombreVisible: "Mi Calendario" };
      expect(error({ borrador: hija, ancestros: [malo({ ingreso: "OVAL" })] })).toEqual({
        codigo: "ASPECTO_INVALIDO",
        token: "ingreso",
      });
      // Un valor inválido que la hija pisa con uno válido no llega a lo resuelto.
      expect(
        error({
          borrador: { ...hija, aspecto: { ingreso: "DIVIDIDO" } },
          ancestros: [malo({ ingreso: "OVAL" }), PRINCIPAL],
        }),
      ).toBeNull();
    });

    it("ASPECTO_INVALIDO se informa después de DEFINICION_INCOMPLETA y antes del contraste, los módulos y el plan", () => {
      const aspecto = { estilo: "x" } as unknown as DefinicionDeMarca["aspecto"];
      expect(error({ borrador: { ...DEFINICION_VACIA, aspecto } })).toMatchObject({
        codigo: "DEFINICION_INCOMPLETA",
      });
      const pocoContraste = { ...PRINCIPAL, tema: { ...PRINCIPAL.tema, "on-primary": "#1a73e9" } };
      expect(
        error({
          borrador: { ...pocoContraste, aspecto, modulosIniciales: ["comandas"] },
          planPorDefecto: { ...PLAN, retirado: true },
        }),
      ).toEqual({ codigo: "ASPECTO_INVALIDO", token: "estilo" });
    });

    it("un aspecto vacío o válido no impide confirmar: no es un hueco de la definición", () => {
      expect(error({ borrador: { ...PRINCIPAL, aspecto: {} } })).toBeNull();
      expect(
        error({ borrador: { ...PRINCIPAL, aspecto: { estilo: "LUDICO", ingreso: "CON_IMAGEN" } } }),
      ).toBeNull();
    });

    it("CONTRASTE_INSUFICIENTE nombra el par, y se informa antes que los módulos y el plan", () => {
      const pocoContraste = { ...PRINCIPAL, tema: { ...PRINCIPAL.tema, "on-primary": "#1a73e9" } };
      expect(error({ borrador: pocoContraste })).toEqual({
        codigo: "CONTRASTE_INSUFICIENTE",
        par: "on-primary/primary",
      });
      const acentoClaro = { ...PRINCIPAL, tema: { ...PRINCIPAL.tema, accent: "#cccccc" } };
      expect(error({ borrador: acentoClaro })).toEqual({
        codigo: "CONTRASTE_INSUFICIENTE",
        par: "accent/fondo",
      });
      expect(
        error({
          borrador: { ...pocoContraste, modulosIniciales: ["comandas"] },
          planPorDefecto: { ...PLAN, retirado: true },
        }),
      ).toMatchObject({ codigo: "CONTRASTE_INSUFICIENTE" });
    });

    it("el contraste se mide sobre el tema RESUELTO, con la herencia", () => {
      const producto = {
        ...DEFINICION_VACIA,
        nombreVisible: "Mi Calendario",
        tema: { "on-primary": "#fefefe" },
      };
      expect(error({ borrador: producto, ancestros: [PRINCIPAL] })).toEqual({
        codigo: "CONTRASTE_INSUFICIENTE",
        par: "on-primary/primary",
      });
    });

    it("MODULO_INICIAL_FUERA_DEL_PLAN: nombra el primer módulo que el plan no incluye", () => {
      expect(
        error({ borrador: { ...PRINCIPAL, modulosIniciales: ["reservas", "comandas", "caja"] } }),
      ).toEqual({
        codigo: "MODULO_INICIAL_FUERA_DEL_PLAN",
        modulo: "comandas",
      });
      expect(
        error({ borrador: { ...PRINCIPAL, modulosIniciales: ["reservas", "stock"] } }),
      ).toBeNull();
      expect(
        error({
          borrador: { ...PRINCIPAL, modulosIniciales: [] },
          planPorDefecto: { ...PLAN, modulos: [] },
        }),
      ).toBeNull();
    });

    it("los módulos iniciales se miden contra los del plan RESUELTO (el del padre, si el producto no define uno)", () => {
      const producto = {
        ...DEFINICION_VACIA,
        nombreVisible: "Mi Calendario",
        modulosIniciales: ["stock"],
      };
      expect(error({ borrador: producto, ancestros: [PRINCIPAL] })).toBeNull();
      expect(
        error({
          borrador: producto,
          ancestros: [PRINCIPAL],
          planPorDefecto: { ...PLAN, modulos: ["reservas"] },
        }),
      ).toEqual({ codigo: "MODULO_INICIAL_FUERA_DEL_PLAN", modulo: "stock" });
    });

    it("MODULO_INICIAL_FUERA_DEL_PLAN se informa antes que PLAN_POR_DEFECTO_RETIRADO", () => {
      expect(
        error({
          borrador: { ...PRINCIPAL, modulosIniciales: ["comandas"] },
          planPorDefecto: { ...PLAN, retirado: true },
        }),
      ).toMatchObject({ codigo: "MODULO_INICIAL_FUERA_DEL_PLAN" });
    });

    it("PLAN_POR_DEFECTO_RETIRADO", () => {
      expect(error({ planPorDefecto: { ...PLAN, retirado: true } })).toEqual({
        codigo: "PLAN_POR_DEFECTO_RETIRADO",
      });
    });
  });

  describe("el plan recibido tiene que ser el de la definición resuelta", () => {
    it("sin plan, o con otro plan, es un defecto del llamador y se lanza", () => {
      expect(() => decidirConfirmacionDeMarca(entrada({ planPorDefecto: null }))).toThrow(
        new RangeError("el plan por defecto recibido no es al que apunta la definición resuelta"),
      );
      expect(() =>
        decidirConfirmacionDeMarca(entrada({ planPorDefecto: { ...PLAN, id: PLAN_B } })),
      ).toThrow(RangeError);
    });
  });

  it("no modifica sus entradas", () => {
    const e = entrada({
      versiones: [{ numero: 1, vigenteDesde: enMs(-DIA) }],
      ancestros: [PRINCIPAL],
      borrador: { ...DEFINICION_VACIA, nombreVisible: "Mi Calendario" },
    });
    const copia = structuredClone(e);
    decidirConfirmacionDeMarca(e);
    expect(e).toEqual(copia);
  });
});

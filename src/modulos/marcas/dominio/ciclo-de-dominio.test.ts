import { describe, expect, it } from "vitest";
import { empresaId, marcaComercialId } from "../../../primitivas/identificadores/marca";
import {
  ESTADOS_DE_DOMINIO,
  LARGO_MAXIMO_DEL_MOTIVO_DE_RETIRO,
  SUPERFICIES_DE_DOMINIO,
  TITULARES_DE_DOMINIO,
  decidirAltaDeDominio,
  decidirCambioDeDominio,
  validarPedidoDeCambioDeDominio,
  type DuenioDeDominio,
  type EstadoDeDominio,
  type PedidoDeAltaDeDominio,
  type PedidoDeCambioDeDominio,
} from "./ciclo-de-dominio";
import { TOLERANCIA_DE_RELOJ_EN_MS } from "./vigencia";

const DE_MARCA: DuenioDeDominio = { tipo: "MARCA", marcaId: marcaComercialId("m-1") };
const DE_EMPRESA: DuenioDeDominio = { tipo: "EMPRESA", empresaId: empresaId("e-1") };

const alta = (cambios: Partial<PedidoDeAltaDeDominio> = {}): PedidoDeAltaDeDominio => ({
  host: "carta.ejemplo.com.ar",
  superficie: "CARTA",
  titular: "CLIENTE",
  esCanonico: false,
  duenio: DE_MARCA,
  ...cambios,
});

describe("las listas de estados, superficies y titulares", () => {
  it("son las mismas que los CHECK de la base (una prueba de integración las compara con ella)", () => {
    expect(ESTADOS_DE_DOMINIO).toEqual([
      "PENDIENTE_VERIFICACION",
      "VERIFICADO",
      "ACTIVO",
      "RETIRADO",
    ]);
    expect(SUPERFICIES_DE_DOMINIO).toEqual(["APP", "CARTA", "LANDING", "CONSOLA"]);
    expect(TITULARES_DE_DOMINIO).toEqual(["CLIENTE", "OPERADOR"]);
    expect(LARGO_MAXIMO_DEL_MOTIVO_DE_RETIRO).toBe(500);
  });
});

describe("decidirAltaDeDominio", () => {
  it("un alta válida sale con el host normalizado y todo lo demás tal cual", () => {
    expect(decidirAltaDeDominio(alta({ host: "Carta.Ejemplo.COM.ar.:443" }))).toEqual({
      ok: true,
      valor: {
        host: "carta.ejemplo.com.ar",
        superficie: "CARTA",
        titular: "CLIENTE",
        esCanonico: false,
        duenio: DE_MARCA,
      },
    });
    expect(
      decidirAltaDeDominio(
        alta({ superficie: "APP", titular: "OPERADOR", esCanonico: true, duenio: DE_MARCA }),
      ),
    ).toMatchObject({
      ok: true,
      valor: { superficie: "APP", titular: "OPERADOR", esCanonico: true, duenio: DE_MARCA },
    });
  });

  it("una marca puede tener host en las cuatro superficies, canónico o no", () => {
    for (const superficie of SUPERFICIES_DE_DOMINIO) {
      for (const esCanonico of [false, true]) {
        const r = decidirAltaDeDominio(alta({ superficie, esCanonico }));
        expect(r.ok && r.valor.superficie === superficie && r.valor.esCanonico === esCanonico).toBe(
          true,
        );
      }
    }
  });

  it("un host inválido es HOST_INVALIDO (la misma regla que normalizarHost)", () => {
    for (const host of [
      "",
      "http://x.com",
      "x.com/ruta",
      "127.0.0.1",
      "ñandú.com",
      "-x.com",
      "a b.com",
    ]) {
      expect(decidirAltaDeDominio(alta({ host })), host).toEqual({
        ok: false,
        error: "HOST_INVALIDO",
      });
    }
  });

  it("la superficie y el titular son exactamente los de la lista (sin minúsculas ni espacios)", () => {
    for (const superficie of ["", "app", "App", " APP", "APP ", "TIENDA"]) {
      expect(decidirAltaDeDominio(alta({ superficie })), superficie).toEqual({
        ok: false,
        error: "SUPERFICIE_INVALIDA",
      });
    }
    for (const titular of ["", "cliente", "Cliente", "CLIENTE ", "DUEÑO"]) {
      expect(decidirAltaDeDominio(alta({ titular })), titular).toEqual({
        ok: false,
        error: "TITULAR_INVALIDO",
      });
    }
  });

  it("un host de empresa es de su aplicación o su carta; la landing y la consola son de una marca", () => {
    for (const superficie of ["APP", "CARTA"]) {
      const r = decidirAltaDeDominio(alta({ superficie, duenio: DE_EMPRESA }));
      expect(r, superficie).toMatchObject({ ok: true, valor: { duenio: DE_EMPRESA } });
    }
    for (const superficie of ["LANDING", "CONSOLA"]) {
      expect(decidirAltaDeDominio(alta({ superficie, duenio: DE_EMPRESA })), superficie).toEqual({
        ok: false,
        error: "SUPERFICIE_NO_ADMITIDA_PARA_EMPRESA",
      });
    }
  });

  it("solo un host de marca puede ser canónico", () => {
    expect(decidirAltaDeDominio(alta({ duenio: DE_EMPRESA, esCanonico: true }))).toEqual({
      ok: false,
      error: "CANONICO_SOLO_DE_MARCA",
    });
    expect(decidirAltaDeDominio(alta({ duenio: DE_EMPRESA, esCanonico: false })).ok).toBe(true);
  });

  it("con varios defectos a la vez sale el primero: host, superficie, titular, superficie de empresa, canónico", () => {
    const todo = alta({
      host: "x/y",
      superficie: "NADA",
      titular: "NADIE",
      duenio: DE_EMPRESA,
      esCanonico: true,
    });
    expect(decidirAltaDeDominio(todo)).toEqual({ ok: false, error: "HOST_INVALIDO" });
    expect(decidirAltaDeDominio({ ...todo, host: "x.com" })).toEqual({
      ok: false,
      error: "SUPERFICIE_INVALIDA",
    });
    expect(decidirAltaDeDominio({ ...todo, host: "x.com", superficie: "LANDING" })).toEqual({
      ok: false,
      error: "TITULAR_INVALIDO",
    });
    expect(
      decidirAltaDeDominio({ ...todo, host: "x.com", superficie: "LANDING", titular: "CLIENTE" }),
    ).toEqual({ ok: false, error: "SUPERFICIE_NO_ADMITIDA_PARA_EMPRESA" });
    expect(
      decidirAltaDeDominio({ ...todo, host: "x.com", superficie: "APP", titular: "CLIENTE" }),
    ).toEqual({ ok: false, error: "CANONICO_SOLO_DE_MARCA" });
  });
});

const AHORA = new Date("2026-10-13T12:00:00.000Z");
const ANTES = new Date("2026-10-13T11:00:00.000Z");

const verificar = (verificadoEn: Date = ANTES): PedidoDeCambioDeDominio => ({
  tipo: "VERIFICAR",
  verificadoEn,
});
const retirar = (motivo = "se fue el cliente"): PedidoDeCambioDeDominio => ({
  tipo: "RETIRAR",
  motivo,
});
const ACTIVAR: PedidoDeCambioDeDominio = { tipo: "ACTIVAR" };
const DESACTIVAR: PedidoDeCambioDeDominio = { tipo: "DESACTIVAR" };

const decidir = (estado: EstadoDeDominio, pedido: PedidoDeCambioDeDominio, esCanonico = false) =>
  decidirCambioDeDominio({ estado, esCanonico }, pedido, AHORA);

const YA = { ok: true, valor: { tipo: "YA_ESTABA" } } as const;
const cambia = (cambio: object) => ({ ok: true, valor: { tipo: "CAMBIA", cambio } }) as const;

describe("decidirCambioDeDominio: la tabla de transiciones", () => {
  it("verificar: solo el pendiente cambia; verificado y activo ya están verificados; retirado no se toca", () => {
    expect(decidir("PENDIENTE_VERIFICACION", verificar())).toEqual(
      cambia({ estado: "VERIFICADO", verificadoEn: ANTES }),
    );
    expect(decidir("VERIFICADO", verificar())).toEqual(YA);
    expect(decidir("ACTIVO", verificar())).toEqual(YA);
    expect(decidir("RETIRADO", verificar())).toEqual({ ok: false, error: "DOMINIO_RETIRADO" });
  });

  it("activar: solo el verificado cambia; el pendiente pide verificación; activo ya está; retirado no se toca", () => {
    expect(decidir("VERIFICADO", ACTIVAR)).toEqual(cambia({ estado: "ACTIVO" }));
    expect(decidir("PENDIENTE_VERIFICACION", ACTIVAR)).toEqual({
      ok: false,
      error: "DOMINIO_SIN_VERIFICAR",
    });
    expect(decidir("ACTIVO", ACTIVAR)).toEqual(YA);
    expect(decidir("RETIRADO", ACTIVAR)).toEqual({ ok: false, error: "DOMINIO_RETIRADO" });
  });

  it("desactivar: verificado y activo vuelven a pendiente; pendiente ya está; retirado no se toca", () => {
    expect(decidir("VERIFICADO", DESACTIVAR)).toEqual(cambia({ estado: "PENDIENTE_VERIFICACION" }));
    expect(decidir("ACTIVO", DESACTIVAR)).toEqual(cambia({ estado: "PENDIENTE_VERIFICACION" }));
    expect(decidir("PENDIENTE_VERIFICACION", DESACTIVAR)).toEqual(YA);
    expect(decidir("RETIRADO", DESACTIVAR)).toEqual({ ok: false, error: "DOMINIO_RETIRADO" });
  });

  it("retirar: de cualquier estado vivo a retirado con el motivo; retirar lo retirado es éxito sin escribir", () => {
    for (const estado of ["PENDIENTE_VERIFICACION", "VERIFICADO", "ACTIVO"] as const) {
      expect(decidir(estado, retirar()), estado).toEqual(
        cambia({ estado: "RETIRADO", motivo: "se fue el cliente" }),
      );
    }
    expect(decidir("RETIRADO", retirar())).toEqual(YA);
  });

  it("el canónico no se retira (en ningún estado vivo), pero sí se verifica, activa y desactiva", () => {
    for (const estado of ["PENDIENTE_VERIFICACION", "VERIFICADO", "ACTIVO"] as const) {
      expect(decidir(estado, retirar(), true), estado).toEqual({
        ok: false,
        error: "DOMINIO_CANONICO",
      });
    }
    expect(decidir("PENDIENTE_VERIFICACION", verificar(), true).ok).toBe(true);
    expect(decidir("VERIFICADO", ACTIVAR, true).ok).toBe(true);
    expect(decidir("ACTIVO", DESACTIVAR, true).ok).toBe(true);
    // un canónico ya retirado (no debería existir) sigue siendo «ya retirado»
    expect(decidir("RETIRADO", retirar(), true)).toEqual(YA);
  });

  it("nunca propone un cambio que la base rechace: todo CAMBIA es una transición permitida", () => {
    const PERMITIDAS: Readonly<Record<EstadoDeDominio, readonly EstadoDeDominio[]>> = {
      PENDIENTE_VERIFICACION: ["VERIFICADO", "RETIRADO"],
      VERIFICADO: ["ACTIVO", "PENDIENTE_VERIFICACION", "RETIRADO"],
      ACTIVO: ["PENDIENTE_VERIFICACION", "RETIRADO"],
      RETIRADO: [],
    };
    for (const desde of ESTADOS_DE_DOMINIO) {
      for (const pedido of [verificar(), ACTIVAR, DESACTIVAR, retirar()]) {
        const r = decidir(desde, pedido);
        if (r.ok && r.valor.tipo === "CAMBIA") {
          expect(PERMITIDAS[desde], `${desde} ${pedido.tipo}`).toContain(r.valor.cambio.estado);
        }
      }
    }
  });
});

describe("la forma del pedido (se mira antes que el estado)", () => {
  it("la fecha de verificación no puede ser inválida", () => {
    expect(decidir("PENDIENTE_VERIFICACION", verificar(new Date("no es una fecha")))).toEqual({
      ok: false,
      error: "FECHA_DE_VERIFICACION_INVALIDA",
    });
  });

  it("la fecha de verificación no puede ser futura: hasta la tolerancia de reloj pasa, un milisegundo más no", () => {
    const limite = new Date(AHORA.getTime() + TOLERANCIA_DE_RELOJ_EN_MS);
    expect(decidir("PENDIENTE_VERIFICACION", verificar(limite)).ok).toBe(true);
    expect(decidir("PENDIENTE_VERIFICACION", verificar(new Date(limite.getTime() + 1)))).toEqual({
      ok: false,
      error: "FECHA_DE_VERIFICACION_INVALIDA",
    });
    expect(decidir("PENDIENTE_VERIFICACION", verificar(AHORA)).ok).toBe(true);
    expect(decidir("PENDIENTE_VERIFICACION", verificar(new Date(0))).ok).toBe(true);
  });

  it("el motivo del retiro es obligatorio: vacío o en blanco es MOTIVO_OBLIGATORIO", () => {
    for (const motivo of ["", " ", "   ", "\n\t "]) {
      expect(decidir("ACTIVO", retirar(motivo)), JSON.stringify(motivo)).toEqual({
        ok: false,
        error: "MOTIVO_OBLIGATORIO",
      });
    }
  });

  it("el motivo se guarda sin espacios en los extremos y tiene un tope de 500 caracteres ya recortado", () => {
    expect(decidir("ACTIVO", retirar("  se fue  "))).toEqual(
      cambia({ estado: "RETIRADO", motivo: "se fue" }),
    );
    const justo = "m".repeat(LARGO_MAXIMO_DEL_MOTIVO_DE_RETIRO);
    expect(decidir("ACTIVO", retirar(justo)).ok).toBe(true);
    expect(decidir("ACTIVO", retirar(` ${justo} `)).ok).toBe(true);
    expect(decidir("ACTIVO", retirar(`${justo}m`))).toEqual({
      ok: false,
      error: "MOTIVO_DEMASIADO_LARGO",
    });
  });

  it("la forma gana al estado: sin motivo o con fecha futura se rechaza aunque el dominio ya esté retirado o ya verificado", () => {
    expect(decidir("RETIRADO", retirar(""))).toEqual({ ok: false, error: "MOTIVO_OBLIGATORIO" });
    expect(decidir("RETIRADO", retirar("m".repeat(501)))).toEqual({
      ok: false,
      error: "MOTIVO_DEMASIADO_LARGO",
    });
    const futura = new Date(AHORA.getTime() + TOLERANCIA_DE_RELOJ_EN_MS + 1);
    expect(decidir("ACTIVO", verificar(futura))).toEqual({
      ok: false,
      error: "FECHA_DE_VERIFICACION_INVALIDA",
    });
    expect(decidir("RETIRADO", verificar(futura))).toEqual({
      ok: false,
      error: "FECHA_DE_VERIFICACION_INVALIDA",
    });
  });
});

describe("validarPedidoDeCambioDeDominio", () => {
  it("devuelve el pedido normalizado: activar y desactivar tal cual, verificar con su fecha, retirar con el motivo recortado", () => {
    expect(validarPedidoDeCambioDeDominio(ACTIVAR, AHORA)).toEqual({ ok: true, valor: ACTIVAR });
    expect(validarPedidoDeCambioDeDominio(DESACTIVAR, AHORA)).toEqual({
      ok: true,
      valor: DESACTIVAR,
    });
    expect(validarPedidoDeCambioDeDominio(verificar(), AHORA)).toEqual({
      ok: true,
      valor: verificar(),
    });
    expect(validarPedidoDeCambioDeDominio(retirar("  x  "), AHORA)).toEqual({
      ok: true,
      valor: { tipo: "RETIRAR", motivo: "x" },
    });
  });

  it("es idempotente: validar lo ya validado no lo cambia", () => {
    const una = validarPedidoDeCambioDeDominio(retirar("  motivo  "), AHORA);
    expect(una.ok).toBe(true);
    if (!una.ok) return;
    expect(validarPedidoDeCambioDeDominio(una.valor, AHORA)).toEqual(una);
  });
});

import { describe, expect, it } from "vitest";
import { importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  armarCobro,
  decidirCajaParaCobrar,
  decidirSesionParaCobrar,
  medioVigenteTipo,
  opcionDeMedioParaCobrar,
  type EntradaParaArmarCobro,
} from "./cobrar";
import { huellaDelCobro } from "./identidad-del-cobro";
import { TIPOS_DE_MEDIO, type TipoDeMedio } from "../estados";

const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CAJA = "1111aaaa-1111-4111-8111-111111111111";
const SUCURSAL = "22222222-2222-4222-8222-222222222222";
const MEDIO = "33333333-3333-4333-8333-333333333333";
const CUENTA = "44444444-4444-4444-8444-444444444444";
const importe = (texto: string): Importe => importeDesdeTexto(ARS, texto);

const entrada: EntradaParaArmarCobro = {
  origen: { tipo: "ventas.cobranza_de_ticket", id: ID },
  origenOrden: 2,
  cajaId: CAJA,
  sucursalId: SUCURSAL,
  medioDePagoId: MEDIO,
  cuentaDeCobroId: CUENTA,
  importe: importe("1500.50"),
  datos: { cupon: "AB-12", cuotas: 3 },
};

describe("armarCobro: la entrada del puerto", () => {
  it("arma la clave del origen y el orden, la huella de la entrada y los datos en su forma completa", () => {
    const r = armarCobro(entrada);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.clave).toBe(`cobro_${ID}_2`);
    expect(r.valor.datos).toEqual({
      cupon: "AB-12",
      ultimos4: null,
      marcaDeTarjetaId: null,
      cuotas: 3,
      dni: null,
    });
    expect(r.valor.huella).toBe(huellaDelCobro({ ...entrada, datos: r.valor.datos }));
    expect(r.valor.huella).toMatch(/^[0-9a-f]{64}$/);
  });

  it("la clave cumple la forma que exige la base", () => {
    const r = armarCobro(entrada);
    expect(r.ok && /^[A-Za-z0-9_-]{16,128}$/.test(r.valor.clave)).toBe(true);
  });

  it("la misma entrada da la misma huella y cualquier campo distinto da otra", () => {
    const base = armarCobro(entrada);
    expect(armarCobro({ ...entrada })).toEqual(base);
    const distintas: EntradaParaArmarCobro[] = [
      { ...entrada, importe: importe("1500.51") },
      { ...entrada, medioDePagoId: CAJA },
      { ...entrada, cuentaDeCobroId: null },
      { ...entrada, cajaId: MEDIO },
      { ...entrada, sucursalId: MEDIO },
      { ...entrada, datos: { cupon: "AB-13", cuotas: 3 } },
      { ...entrada, datos: { cupon: "AB-12" } },
      { ...entrada, origen: { tipo: "ventas.otra_cosa", id: ID } },
    ];
    const huellas = new Set([base.ok ? base.valor.huella : ""]);
    for (const otra of distintas) {
      const r = armarCobro(otra);
      expect(r.ok).toBe(true);
      huellas.add(r.ok ? r.valor.huella : "");
    }
    expect(huellas.size).toBe(distintas.length + 1);
  });

  it("un origen mal formado o un orden fuera de 1..50 se rechaza", () => {
    for (const origen of [
      { tipo: "ventas", id: ID },
      { tipo: "ventas.cobranza_de_ticket", id: "x" },
    ]) {
      expect(armarCobro({ ...entrada, origen })).toEqual({ ok: false, error: "ORIGEN_INVALIDO" });
    }
    for (const origenOrden of [0, 51, 1.5]) {
      expect(armarCobro({ ...entrada, origenOrden })).toEqual({
        ok: false,
        error: "ORIGEN_INVALIDO",
      });
    }
    expect(armarCobro({ ...entrada, origenOrden: 1 }).ok).toBe(true);
    expect(armarCobro({ ...entrada, origenOrden: 50 }).ok).toBe(true);
  });

  it("el id del origen va en minúsculas: con mayúsculas armaría otra clave para el mismo cobro", () => {
    expect(armarCobro({ ...entrada, origen: { ...entrada.origen, id: ID.toUpperCase() } })).toEqual(
      { ok: false, error: "ORIGEN_INVALIDO" },
    );
  });

  it("cero y negativo se rechazan SIEMPRE; también lo que pasa el tope; el tope exacto entra", () => {
    for (const monto of ["0.00", "-0.01", "-100.00", "1000000000.00", "999999999.99x"]) {
      let r;
      try {
        r = armarCobro({ ...entrada, importe: importe(monto) });
      } catch {
        continue; // un texto que la primitiva ni siquiera puede leer
      }
      expect(r, monto).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
    }
    expect(armarCobro({ ...entrada, importe: importe("0.01") }).ok).toBe(true);
    expect(armarCobro({ ...entrada, importe: importe("999999999.99") }).ok).toBe(true);
  });

  it("una moneda que no es ARS se rechaza antes de mirar el importe", () => {
    const usd: Importe = { ...importe("1.00"), moneda: "USD" as never };
    expect(armarCobro({ ...entrada, importe: usd })).toEqual({
      ok: false,
      error: "MONEDA_NO_SOPORTADA",
    });
  });

  it("los identificadores que no son un uuid en minúsculas no pueden existir", () => {
    expect(armarCobro({ ...entrada, cajaId: "x" })).toEqual({
      ok: false,
      error: "CAJA_NO_ENCONTRADA",
    });
    expect(armarCobro({ ...entrada, cajaId: CAJA.toUpperCase() })).toEqual({
      ok: false,
      error: "CAJA_NO_ENCONTRADA",
    });
    expect(armarCobro({ ...entrada, medioDePagoId: "x" })).toEqual({
      ok: false,
      error: "MEDIO_NO_ENCONTRADO",
    });
    expect(armarCobro({ ...entrada, cuentaDeCobroId: "x" })).toEqual({
      ok: false,
      error: "CUENTA_DE_COBRO_NO_ENCONTRADA",
    });
    expect(armarCobro({ ...entrada, cuentaDeCobroId: null }).ok).toBe(true);
  });
});

describe("decidirCajaParaCobrar", () => {
  const caja = { sucursalId: SUCURSAL, activa: true };
  it("una caja activa de la sucursal pedida sirve", () => {
    expect(decidirCajaParaCobrar({ caja, sucursalPedida: SUCURSAL })).toEqual({
      ok: true,
      valor: null,
    });
  });
  it("no existe, está desactivada o es de otra sucursal", () => {
    expect(decidirCajaParaCobrar({ caja: null, sucursalPedida: SUCURSAL })).toEqual({
      ok: false,
      error: "CAJA_NO_ENCONTRADA",
    });
    expect(
      decidirCajaParaCobrar({ caja: { ...caja, activa: false }, sucursalPedida: SUCURSAL }),
    ).toEqual({ ok: false, error: "CAJA_INACTIVA" });
    expect(decidirCajaParaCobrar({ caja, sucursalPedida: CAJA })).toEqual({
      ok: false,
      error: "CAJA_DE_OTRA_SUCURSAL",
    });
  });
  it("la inactiva se informa antes que la de otra sucursal", () => {
    expect(
      decidirCajaParaCobrar({
        caja: { sucursalId: CAJA, activa: false },
        sucursalPedida: SUCURSAL,
      }),
    ).toEqual({ ok: false, error: "CAJA_INACTIVA" });
  });
});

describe("decidirSesionParaCobrar", () => {
  it("una sesión abierta recibe el cobro", () => {
    expect(
      decidirSesionParaCobrar({ cajaId: CAJA, sesionVigente: { id: ID, estado: "ABIERTA" } }),
    ).toEqual({ ok: true, valor: { sesionId: ID } });
  });
  it("sin sesión: SIN_SESION_ABIERTA con la caja", () => {
    expect(decidirSesionParaCobrar({ cajaId: CAJA, sesionVigente: null })).toEqual({
      ok: false,
      error: { codigo: "SIN_SESION_ABIERTA", cajaId: CAJA },
    });
  });
  it("con la sesión contándose: CAJA_EN_CIERRE con la caja y la sesión", () => {
    expect(
      decidirSesionParaCobrar({ cajaId: CAJA, sesionVigente: { id: ID, estado: "EN_CIERRE" } }),
    ).toEqual({ ok: false, error: { codigo: "CAJA_EN_CIERRE", cajaId: CAJA, sesionId: ID } });
  });
  it("una sesión cerrada no recibe cobros: es como no tener sesión", () => {
    expect(
      decidirSesionParaCobrar({ cajaId: CAJA, sesionVigente: { id: ID, estado: "CERRADA" } }),
    ).toEqual({ ok: false, error: { codigo: "SIN_SESION_ABIERTA", cajaId: CAJA } });
  });
});

describe("opcionDeMedioParaCobrar", () => {
  const todos = { cupon: true, ultimos4: true, marca: true, cuotas: true, dni: true };
  const ninguno = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };
  const terminal = { id: "t", tipo: "TERMINAL", nombre: "Terminal" } as const;
  const qr = { id: "q", tipo: "QR", nombre: "QR 1" } as const;
  const banco = { id: "b", tipo: "CUENTA_BANCARIA", nombre: "Banco" } as const;
  const cuentas = [terminal, qr, banco];
  const medio = (tipo: TipoDeMedio, pide = ninguno) => ({ id: "m", tipo, nombre: null, pide });

  it("cada tipo ofrece solo las cuentas que admite (el efectivo, ninguna)", () => {
    const ids = (tipo: TipoDeMedio) =>
      opcionDeMedioParaCobrar(medio(tipo), cuentas).cuentas.map((c) => c.id);
    expect(ids("EFECTIVO")).toEqual([]);
    expect(ids("TARJETA_DEBITO")).toEqual(["t"]);
    expect(ids("TARJETA_CREDITO")).toEqual(["t"]);
    expect(ids("QR")).toEqual(["t", "q"]);
    expect(ids("TRANSFERENCIA")).toEqual(["b"]);
    expect(ids("OTRO")).toEqual(["t", "q", "b"]);
  });

  it("la cuenta nunca es obligatoria (decisión 151) y el medio puede quedar sin ninguna", () => {
    for (const tipo of TIPOS_DE_MEDIO) {
      expect(opcionDeMedioParaCobrar(medio(tipo), []).cuentaObligatoria, tipo).toBe(false);
      expect(opcionDeMedioParaCobrar(medio(tipo), []).cuentas, tipo).toEqual([]);
    }
  });

  it("devuelve solo id, tipo y nombre de cada cuenta", () => {
    const [cuenta] = opcionDeMedioParaCobrar(medio("QR"), [
      { ...qr, identificadorExterno: "secreto" } as typeof qr,
    ]).cuentas;
    expect(cuenta).toEqual({ id: "q", tipo: "QR", nombre: "QR 1" });
  });

  it("los datos que pide: solo los que el tipo admite y el medio habilitó", () => {
    const pide = (tipo: TipoDeMedio, habilitados = todos) =>
      opcionDeMedioParaCobrar(medio(tipo, habilitados), []).datosQuePide;
    expect(pide("EFECTIVO")).toEqual(ninguno);
    expect(pide("QR")).toEqual(ninguno);
    expect(pide("OTRO")).toEqual(ninguno);
    expect(pide("TARJETA_DEBITO")).toEqual({
      ...ninguno,
      cupon: true,
      ultimos4: true,
      marca: true,
    });
    expect(pide("TARJETA_CREDITO")).toEqual({ ...todos, dni: false });
    expect(pide("TRANSFERENCIA")).toEqual({ ...ninguno, dni: true });
    // Lo que el medio no habilitó no se ofrece aunque el tipo lo admita.
    expect(pide("TARJETA_CREDITO", { ...ninguno, cuotas: true })).toEqual({
      ...ninguno,
      cuotas: true,
    });
    expect(pide("TRANSFERENCIA", ninguno)).toEqual(ninguno);
  });

  it("conserva el nombre del medio (o null)", () => {
    expect(opcionDeMedioParaCobrar({ ...medio("EFECTIVO"), nombre: "Pesos" }, []).nombre).toBe(
      "Pesos",
    );
    expect(opcionDeMedioParaCobrar(medio("EFECTIVO"), []).nombre).toBeNull();
    expect(opcionDeMedioParaCobrar(medio("EFECTIVO"), []).tipo).toBe("EFECTIVO");
    expect(opcionDeMedioParaCobrar(medio("EFECTIVO"), []).id).toBe("m");
  });
});

describe("medioVigenteTipo", () => {
  it("sin correcciones es el original", () => {
    expect(medioVigenteTipo("EFECTIVO", [])).toBe("EFECTIVO");
  });
  it("es el destino de la corrección de mayor secuencia, en cualquier orden", () => {
    expect(
      medioVigenteTipo("EFECTIVO", [
        { secuencia: 2, medioDespuesTipo: "QR" },
        { secuencia: 1, medioDespuesTipo: "TARJETA_DEBITO" },
      ]),
    ).toBe("QR");
    expect(medioVigenteTipo("EFECTIVO", [{ secuencia: 1, medioDespuesTipo: "OTRO" }])).toBe("OTRO");
  });
});

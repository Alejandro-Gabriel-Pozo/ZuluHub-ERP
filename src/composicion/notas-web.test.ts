import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  anularLaNota,
  notasDeLaFactura,
  registrarLaNota,
  type DependenciasDeNotasWeb,
} from "./notas-web";

const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;
const FACTURA = "0b0b0b0b-1111-4222-8333-444444444444";
const PROVEEDOR = "0c0c0c0c-1111-4222-8333-444444444444";
const CLAVE = "0d0d0d0d-1111-4222-8333-444444444444";
const NOTA = "0e0e0e0e-1111-4222-8333-444444444444";

const LECTURA = {
  facturaId: FACTURA,
  proveedorId: PROVEEDOR,
  tipo: "FACTURA_A",
  puntoDeVenta: 3,
  numero: 12345,
  totalDeLaFactura: "1876710.00",
  acreditado: "121000.00",
  debitado: "12100.00",
  netoAPagar: "1755710.00",
  saldoAFavorPendiente: null,
  // Campos que la pantalla no necesita no salen (lista de permitidos).
  interno: "no sale",
  notas: [
    {
      comprobanteId: NOTA,
      proveedorId: PROVEEDOR,
      facturaId: FACTURA,
      clase: "NOTA_DE_CREDITO" as const,
      tipo: "NOTA_CREDITO_A",
      puntoDeVenta: 3,
      numero: 77,
      fechaNegocio: "2026-11-27",
      total: "121000.00",
      estado: "REGISTRADO",
      otro: "no sale",
    },
  ],
};

type Llamada = Readonly<{ que: string; entrada: unknown }>;

const montar = (
  opciones: Readonly<{
    lectura?: () => unknown;
    caso?: () => unknown;
  }> = {},
) => {
  const llamadas: Llamada[] = [];
  const registrados: string[] = [];
  const lectura = opciones.lectura ?? (() => ok(LECTURA));
  const caso =
    opciones.caso ?? (() => ok({ comprobanteId: NOTA, yaExistia: false, yaEstaba: false }));
  const llamar = (que: string) => (_c: unknown, entrada: unknown) => {
    llamadas.push({ que, entrada });
    return Promise.resolve(caso());
  };
  const d = {
    consultas: () => ({
      notasDeLaFactura: (_c: unknown, entrada: unknown) => {
        llamadas.push({ que: "notasDeLaFactura", entrada });
        return Promise.resolve(lectura());
      },
    }),
    casosDeUso: () => ({
      registrarNotaDeCredito: llamar("registrarNotaDeCredito"),
      registrarNotaDeDebito: llamar("registrarNotaDeDebito"),
      anularNotaDeCredito: llamar("anularNotaDeCredito"),
      anularNotaDeDebito: llamar("anularNotaDeDebito"),
    }),
    respuesta: { registrar: (detalle: string) => registrados.push(detalle) },
  } as unknown as DependenciasDeNotasWeb;
  return { d, llamadas, registrados };
};

const GENERICO = { ok: false, error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } };
const pedido = (extra: Record<string, unknown> = {}) => ({
  clave: CLAVE,
  facturaId: FACTURA,
  nota: {
    tipo: "NOTA_CREDITO_A",
    puntoDeVenta: "3",
    numero: "77",
    fecha: "2026-11-27",
    importes: [{ alicuota: "21", neto: "100000.00" }],
    totalSegunNota: "121000.00",
  },
  ...extra,
});

describe("notasDeLaFactura", () => {
  it("pide la lectura con el id y devuelve lo del servidor tal cual, como texto, sin campos de más", async () => {
    const { d, llamadas } = montar();
    expect(await notasDeLaFactura(d, contexto, FACTURA)).toEqual({
      ok: true,
      dato: {
        facturaId: FACTURA,
        tipo: "FACTURA_A",
        puntoDeVenta: 3,
        numero: 12345,
        totalDeLaFactura: "1876710.00",
        acreditado: "121000.00",
        debitado: "12100.00",
        netoAPagar: "1755710.00",
        saldoAFavorPendiente: null,
        notas: [
          {
            comprobanteId: NOTA,
            clase: "NOTA_DE_CREDITO",
            tipo: "NOTA_CREDITO_A",
            puntoDeVenta: 3,
            numero: 77,
            fechaNegocio: "2026-11-27",
            total: "121000.00",
            estado: "REGISTRADO",
          },
        ],
      },
    });
    expect(llamadas).toEqual([{ que: "notasDeLaFactura", entrada: { facturaId: FACTURA } }]);
  });

  it("el saldo a favor sale tal cual cuando existe", async () => {
    const { d } = montar({ lectura: () => ok({ ...LECTURA, saldoAFavorPendiente: "500.00" }) });
    expect(await notasDeLaFactura(d, contexto, FACTURA)).toMatchObject({
      ok: true,
      dato: { saldoAFavorPendiente: "500.00" },
    });
  });

  it("una factura que no existe o es de otra empresa (la lectura da null) es el genérico", async () => {
    const { d } = montar({ lectura: () => ok(null) });
    expect(await notasDeLaFactura(d, contexto, FACTURA)).toMatchObject(GENERICO);
  });

  it("un id que no es un UUID es el genérico y ni siquiera lee", async () => {
    const { d, llamadas } = montar();
    expect(await notasDeLaFactura(d, contexto, "no")).toMatchObject(GENERICO);
    expect(llamadas).toEqual([]);
  });

  it("el rechazo del guard sale con su código y una excepción sale sin detalle", async () => {
    const rechazo = montar({ lectura: () => err("SIN_PERMISO") });
    expect(await notasDeLaFactura(rechazo.d, contexto, FACTURA)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    expect(rechazo.registrados).toEqual([]);
    const falla = montar({
      lectura: () => {
        throw new Error("se cayó la base: secreto");
      },
    });
    const r = await notasDeLaFactura(falla.d, contexto, FACTURA);
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain("secreto");
    expect(falla.registrados).toHaveLength(1);
  });
});

describe("registrarLaNota", () => {
  it("de crédito: el proveedor sale de la FACTURA (la lectura del servidor) y el caso recibe solo lo declarado, con la clase de la acción", async () => {
    const { d, llamadas } = montar();
    expect(await registrarLaNota(d, contexto, "CREDITO", pedido())).toEqual({
      ok: true,
      dato: { comprobanteId: NOTA, yaExistia: false },
    });
    expect(llamadas).toEqual([
      { que: "notasDeLaFactura", entrada: { facturaId: FACTURA } },
      {
        que: "registrarNotaDeCredito",
        entrada: {
          clave: CLAVE,
          proveedorId: PROVEEDOR,
          facturaId: FACTURA,
          nota: {
            tipo: "NOTA_CREDITO_A",
            puntoDeVenta: 3,
            numero: 77,
            fecha: "2026-11-27",
            importes: [{ alicuota: "21", neto: "100000.00" }],
            totalSegunNota: "121000.00",
          },
        },
      },
    ]);
  });

  it("de débito usa el caso de débito, no el de crédito", async () => {
    const { d, llamadas } = montar();
    await registrarLaNota(d, contexto, "DEBITO", pedido());
    expect(llamadas.map((l) => l.que)).toEqual(["notasDeLaFactura", "registrarNotaDeDebito"]);
  });

  it("repetir devuelve lo hecho con yaExistia", async () => {
    const { d } = montar({ caso: () => ok({ comprobanteId: NOTA, yaExistia: true }) });
    expect(await registrarLaNota(d, contexto, "CREDITO", pedido())).toEqual({
      ok: true,
      dato: { comprobanteId: NOTA, yaExistia: true },
    });
  });

  it("el proveedor, la empresa o la persona que mande el navegador rechazan el pedido y no leen ni escriben nada", async () => {
    for (const extra of [{ proveedorId: PROVEEDOR }, { empresaId: "e2" }, { personaId: "p" }]) {
      const { d, llamadas } = montar();
      expect(await registrarLaNota(d, contexto, "CREDITO", pedido(extra))).toMatchObject(GENERICO);
      expect(llamadas).toEqual([]);
    }
  });

  it("una factura que no existe (la lectura da null) es el genérico y no se escribe nada", async () => {
    const { d, llamadas } = montar({ lectura: () => ok(null) });
    expect(await registrarLaNota(d, contexto, "CREDITO", pedido())).toMatchObject(GENERICO);
    expect(llamadas.map((l) => l.que)).toEqual(["notasDeLaFactura"]);
  });

  it("si la lectura se rechaza (sin permiso, fuera de alcance) sale su código y no se escribe nada", async () => {
    const { d, llamadas } = montar({ lectura: () => err("SIN_PERMISO") });
    expect(await registrarLaNota(d, contexto, "DEBITO", pedido())).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    expect(llamadas.map((l) => l.que)).toEqual(["notasDeLaFactura"]);
  });

  it("un rechazo de negocio del caso (tope, duplicada, tipo de otra clase) sale como el genérico, sin datos internos", async () => {
    for (const error of [
      "NOTA_DE_CREDITO_EXCEDE_LA_FACTURA",
      "TIPO_DE_NOTA_INVALIDO",
      { error: "COMPROBANTE_YA_REGISTRADO", comprobanteId: NOTA },
    ]) {
      const { d } = montar({ caso: () => err(error) });
      const r = await registrarLaNota(d, contexto, "CREDITO", pedido());
      expect(r).toMatchObject({ ok: false });
      expect(JSON.stringify(r)).not.toContain(NOTA);
    }
  });

  it("una excepción del caso sale sin detalle y con referencia", async () => {
    const { d, registrados } = montar({
      caso: () => {
        throw new Error("se cayó: secreto");
      },
    });
    const r = await registrarLaNota(d, contexto, "CREDITO", pedido());
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain("secreto");
    expect(registrados).toHaveLength(1);
  });
});

describe("anularLaNota", () => {
  it("de crédito: el caso recibe la nota y el motivo, y devuelve si ya estaba anulada", async () => {
    const { d, llamadas } = montar({ caso: () => ok({ yaEstaba: false }) });
    expect(await anularLaNota(d, contexto, "CREDITO", { notaId: NOTA, motivo: "Mal" })).toEqual({
      ok: true,
      dato: { yaEstaba: false },
    });
    expect(llamadas).toEqual([
      { que: "anularNotaDeCredito", entrada: { comprobanteId: NOTA, motivo: "Mal" } },
    ]);
  });

  it("de débito usa el caso de débito y repetir devuelve yaEstaba", async () => {
    const { d, llamadas } = montar({ caso: () => ok({ yaEstaba: true }) });
    expect(await anularLaNota(d, contexto, "DEBITO", { notaId: NOTA, motivo: "Mal" })).toEqual({
      ok: true,
      dato: { yaEstaba: true },
    });
    expect(llamadas.map((l) => l.que)).toEqual(["anularNotaDeDebito"]);
  });

  it("una nota que ya descontó un pago sale con su texto propio (el del dueño) y no con el genérico", async () => {
    const { d } = montar({ caso: () => err("NOTA_DE_CREDITO_CON_PAGO") });
    expect(
      await anularLaNota(d, contexto, "CREDITO", { notaId: NOTA, motivo: "Mal" }),
    ).toMatchObject({
      ok: false,
      error: { codigo: "COMPRAS_NOTA_CON_PAGO", clave: "compras.error.nota_con_pago" },
    });
  });

  it("otro rechazo de negocio es el genérico; una clase o un campo que mande el navegador rechazan el pedido sin escribir", async () => {
    const rechazo = montar({ caso: () => err("COMPROBANTE_YA_PAGADO") });
    expect(
      await anularLaNota(rechazo.d, contexto, "DEBITO", { notaId: NOTA, motivo: "Mal" }),
    ).toMatchObject(GENERICO);
    for (const crudo of [
      { notaId: NOTA, motivo: "Mal", clase: "CREDITO" },
      { notaId: NOTA, motivo: "Mal", empresaId: "e2" },
      { notaId: "no", motivo: "Mal" },
      { notaId: NOTA },
    ]) {
      const { d, llamadas } = montar();
      expect(await anularLaNota(d, contexto, "CREDITO", crudo)).toMatchObject(GENERICO);
      expect(llamadas).toEqual([]);
    }
  });
});

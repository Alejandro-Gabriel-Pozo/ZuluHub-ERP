import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PantallaDeLaFichaDeCuenta } from "./PantallaDeLaFichaDeCuenta";
import { PantallaDeLaListaDeCuentas } from "./PantallaDeLaListaDeCuentas";
import {
  armarLaFichaDeLaCuenta,
  armarLaListaDeCuentas,
  clientesParaElegir,
  type FichaDeCuentaParaLaPantalla,
  type ListaDeCuentasParaLaPantalla,
} from "./modelo-de-cuenta-corriente";
import { textosDeCuentaCorriente } from "./textos-de-cuenta-corriente";

/**
 * El modelo y el dibujo de la cuenta corriente (CC-5, A1): lo que el servidor entrega se muestra tal cual (el modelo no calcula dinero), un dato ausente es «—», un cliente sin nombre no inventa uno, el motivo de una
 * suspensión se muestra como TEXTO (nunca como HTML) y la pantalla no ofrece ninguna acción de escritura. Previene: un importe recalculado en pantalla, un cero inventado y un motivo que inyecta marcado.
 */
const T = textosDeCuentaCorriente();
const ARS = (monto: string) => ({ moneda: "ARS", monto });
const LISTA: ListaDeCuentasParaLaPantalla = {
  orden: "VENCIDO",
  alDia: "2026-11-26",
  clientes: [
    {
      parteId: "11111111-1111-4111-8111-111111111111",
      nombre: "Panadería Sol",
      cuit: "20-12345678-6",
      estado: "EXCEDIDA",
      saldo: ARS("150000.00"),
      vencido: ARS("40000.00"),
      limite: ARS("100000.00"),
      disponible: ARS("0.00"),
      cargoMasAntiguo: { fecha: "2026-10-01", dias: 56 },
    },
    {
      parteId: "22222222-2222-4222-8222-222222222222",
      nombre: null,
      cuit: null,
      estado: "HABILITADA",
      saldo: ARS("0.00"),
      vencido: ARS("0.00"),
      limite: ARS("50000.00"),
      disponible: ARS("50000.00"),
      cargoMasAntiguo: null,
    },
  ],
};
const FICHA: FichaDeCuentaParaLaPantalla = {
  parteId: "11111111-1111-4111-8111-111111111111",
  nombre: "Panadería Sol",
  cuit: "20-12345678-6",
  estado: "SUSPENDIDA",
  motivoDeSuspension: '<img src=x onerror="alert(1)">',
  plazoDias: 30,
  limite: ARS("100000.00"),
  saldo: ARS("-2500.50"),
  disponible: ARS("102500.50"),
  movimientos: [
    {
      fecha: "2026-10-01",
      tipo: "VENTA_A_CUENTA",
      vence: "2026-10-31",
      vencida: true,
      ticketId: null,
      importe: ARS("10000.00"),
      ticket: { numero: 42, canal: "SALON", sucursal: "Centro" },
      medioDePago: null,
    },
    {
      fecha: "2026-10-05",
      tipo: "COBRANZA",
      vence: null,
      vencida: false,
      ticketId: null,
      importe: ARS("-4000.00"),
      ticket: { numero: 43, canal: "MOSTRADOR", sucursal: null },
      medioDePago: "EFECTIVO",
    },
    {
      fecha: "2026-10-06",
      tipo: "COBRANZA",
      vence: null,
      vencida: false,
      ticketId: null,
      importe: ARS("-100.00"),
      ticket: null,
      medioDePago: null,
    },
  ],
};

describe("el modelo de la lista de cuentas", () => {
  const m = armarLaListaDeCuentas(LISTA, T);

  it("muestra los importes tal como llegan, con la fecha y los días del cargo más antiguo", () => {
    expect(m.filas[0]).toMatchObject({
      saldo: "$ 150.000,00",
      vencido: "$ 40.000,00",
      limite: "$ 100.000,00",
      creditoDisponible: "$ 0,00",
      cargoMasAntiguo: "01/10/2026 · 56 días",
      estado: { texto: "Excedida", tono: "aviso" },
      href: "/caja/cuenta-corriente/11111111-1111-4111-8111-111111111111",
    });
  });

  it("un dato ausente es «—», nunca un cero ni un nombre inventado, y el orden vigente queda marcado", () => {
    expect(m.filas[1]).toMatchObject({ cuit: "—", cargoMasAntiguo: "—", cliente: "Cliente" });
    expect(m.ordenes.map((o) => [o.orden, o.activo])).toEqual([
      ["SALDO", false],
      ["VENCIDO", true],
      ["ANTIGUEDAD", false],
    ]);
    expect(m.ordenes[1]?.href).toBe("/caja/cuenta-corriente?orden=VENCIDO");
    expect(m.vacio).toBeNull();
  });

  it("sin clientes muestra el texto de vacío", () => {
    expect(armarLaListaDeCuentas({ ...LISTA, clientes: [] }, T).vacio).toBe("Sin resultados");
  });
});

describe("el modelo de la ficha", () => {
  const m = armarLaFichaDeLaCuenta(FICHA, T);

  it("arma el banner de la cuenta suspendida solo si está suspendida y tiene motivo", () => {
    expect(m.suspendida?.titulo).toBe("Cuenta suspendida:");
    expect(m.suspendida?.detalle).toContain('Motivo: «<img src=x onerror="alert(1)">»');
    expect(armarLaFichaDeLaCuenta({ ...FICHA, estado: "HABILITADA" }, T).suspendida).toBeNull();
    expect(armarLaFichaDeLaCuenta({ ...FICHA, motivoDeSuspension: null }, T).suspendida).toBeNull();
  });

  it("describe cada movimiento con su origen; sin ticket o sin medio, «—»", () => {
    expect(m.movimientos.map((x) => [x.movimiento, x.origen, x.vence, x.vencida])).toEqual([
      ["Venta a cuenta", "Ticket 42 · Salón · Centro", "31/10/2026", "Vencida"],
      ["Cobranza · Efectivo", "Cobro del ticket 43", "—", null],
      ["Cobranza · —", "—", "—", null],
    ]);
    expect(m.movimientos[1]?.importe).toBe("-$ 4.000,00");
    expect(m.condiciones.plazo.valor).toBe("30 días");
    expect(m.condiciones.saldo.valor).toBe("-$ 2.500,50");
  });
});

describe("el dibujo", () => {
  it("la lista es una tabla con un enlace por cliente y ningún botón ni formulario", () => {
    const html = renderToStaticMarkup(<PantallaDeLaListaDeCuentas lista={LISTA} textos={T} />);
    expect(html).toContain('href="/caja/cuenta-corriente/11111111-1111-4111-8111-111111111111"');
    expect(html).toContain("Panadería Sol");
    expect(html).not.toMatch(/<(button|form|input)\b/);
  });

  it("la ficha escapa el motivo (no es marcado) y no ofrece acciones de escritura", () => {
    const html = renderToStaticMarkup(<PantallaDeLaFichaDeCuenta ficha={FICHA} textos={T} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain("Cuenta suspendida:");
    expect(html).not.toMatch(/<(button|form|input)\b/);
  });
});

describe("las opciones de «Habilitar cuenta corriente»", () => {
  it("muestran «Nombre · CUIT»; un cliente sin CUIT sale con «—» y no se puede habilitar; uno sin nombre, sin inventarlo", () => {
    expect(
      clientesParaElegir(
        [
          { parteId: "a", nombre: "Turismo Andino S. A.", cuit: "30689012345" },
          { parteId: "b", nombre: "Kiosco", cuit: null },
          { parteId: "c", nombre: null, cuit: "20123456786" },
        ],
        T,
      ),
    ).toEqual([
      {
        parteId: "a",
        etiqueta: "Turismo Andino S. A. · 30-68901234-5",
        nombre: "Turismo Andino S. A.",
        tieneCuit: true,
      },
      { parteId: "b", etiqueta: "Kiosco · —", nombre: "Kiosco", tieneCuit: false },
      { parteId: "c", etiqueta: "Cliente · 20-12345678-6", nombre: "Cliente", tieneCuit: true },
    ]);
  });
});

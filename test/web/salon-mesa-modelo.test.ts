import { describe, expect, it } from "vitest";
import {
  armarLaMesa,
  mesasLibresParaElCambio,
  textosDeLaMesa,
  type FichaDeLaMesaDeLaPantalla,
  type LineaDeLaFichaDeLaPantalla,
} from "../../apps/web/ui/plantillas/salon/modelo-de-la-mesa";

/**
 * El modelo de la ficha de la mesa (SAL-B): tres modos y solo la mesa con UNA cuenta ofrece acciones; los platos se agrupan por su estado de comanda (solo los grupos con platos); un plato enviado no se quita ni cambia su
 * salida; «Liberar» solo con la cuenta sin platos; el dinero es texto decimal en ARS. Previene: ofrecer acciones sobre una mesa unida o dividida, quitar un plato enviado y mostrar importes que pasaron por `number`.
 */
const ARS = (monto: string) => ({ moneda: "ARS", monto });
const linea = (extra: Partial<LineaDeLaFichaDeLaPantalla> & { lineaId: string }) => ({
  posicion: 1,
  descripcion: "Milanesa",
  varianteNombre: null,
  cantidad: "2.0000",
  importe: "19000.00",
  compartida: false,
  comanda: "PARA_ENVIAR",
  numeroDeEnvio: null,
  envioId: null,
  deLaMesa: null,
  ...extra,
});
const ficha = (extra: Partial<FichaDeLaMesaDeLaPantalla> = {}): FichaDeLaMesaDeLaPantalla => ({
  mesaId: "m1",
  numero: 7,
  estado: "EN_PEDIDO",
  unidaAMesa: null,
  cuentas: [
    {
      cuentaId: "c1",
      parte: null,
      total: ARS("21500.50"),
      lineas: [
        linea({ lineaId: "a" }),
        linea({ lineaId: "b", comanda: "ESPERA", descripcion: "Flan", varianteNombre: "Grande" }),
        linea({
          lineaId: "c",
          comanda: "ENVIADA",
          numeroDeEnvio: 1,
          deLaMesa: 3,
          cantidad: "1.5000",
        }),
      ],
    },
  ],
  ...extra,
});

describe("armarLaMesa", () => {
  it("mesa libre: solo «Tomar pedido»", () => {
    const m = armarLaMesa({}, ficha({ estado: "LIBRE", cuentas: [] }));
    expect(m).toMatchObject({ titulo: "Mesa 7", modo: "LIBRE", cuentaId: null, grupos: [] });
  });

  it("una cuenta: los platos se agrupan por estado de comanda, en ese orden, con su cantidad, medida y total en pesos", () => {
    const m = armarLaMesa({}, ficha());
    expect(m.modo).toBe("CON_CUENTA");
    expect(m.cuentaId).toBe("c1");
    expect(m.total).toBe("$ 21.500,50");
    expect(m.grupos.map((g) => [g.comanda, g.titulo, g.platos.map((p) => p.nombre)])).toEqual([
      ["PARA_ENVIAR", "Para enviar", ["2 × Milanesa"]],
      ["ESPERA", "Esperan para después", ["2 × Flan · Grande"]],
      ["ENVIADA", "Enviadas", ["1,5 × Milanesa"]],
    ]);
    expect(m.grupos[0]?.platos[0]?.importe).toBe("$ 19.000,00");
  });

  it("solo un plato todavía no enviado se quita y cambia su salida; el enviado dice su envío y de qué mesa vino", () => {
    const m = armarLaMesa({}, ficha());
    const [paraEnviar, espera, enviada] = m.grupos.map((g) => g.platos[0]);
    expect([paraEnviar?.quitable, paraEnviar?.salida]).toEqual([true, "AHORA"]);
    expect([espera?.quitable, espera?.salida]).toEqual([true, "DESPUES"]);
    expect([enviada?.quitable, enviada?.salida]).toEqual([false, null]);
    expect(enviada?.nota).toBe("Envío 1 · De la mesa 3");
  });

  it("solo salen los grupos que tienen platos", () => {
    const f = ficha();
    const unica = f.cuentas[0];
    if (unica === undefined) throw new Error("falta la cuenta");
    const m = armarLaMesa({}, { ...f, cuentas: [{ ...unica, lineas: [linea({ lineaId: "a" })] }] });
    expect(m.grupos.map((g) => g.comanda)).toEqual(["PARA_ENVIAR"]);
    expect(m.sinPlatos).toBe(false);
  });

  it("una cuenta sin platos: «La mesa no tiene pedido» y se puede liberar", () => {
    const f = ficha();
    const unica = f.cuentas[0];
    if (unica === undefined) throw new Error("falta la cuenta");
    const m = armarLaMesa({}, { ...f, cuentas: [{ ...unica, lineas: [], total: ARS("0.00") }] });
    expect(m).toMatchObject({ modo: "CON_CUENTA", sinPlatos: true, grupos: [], total: "$ 0,00" });
  });

  it("una línea compartida no muestra importe propio y dice «Compartido»", () => {
    const f = ficha();
    const unica = f.cuentas[0];
    if (unica === undefined) throw new Error("falta la cuenta");
    const m = armarLaMesa(
      {},
      { ...f, cuentas: [{ ...unica, lineas: [linea({ lineaId: "a", compartida: true })] }] },
    );
    expect(m.grupos[0]?.platos[0]).toMatchObject({ importe: null, nota: "Compartido" });
  });

  it("mesa unida: solo lectura, dice a qué mesa; sin acciones", () => {
    const m = armarLaMesa({}, ficha({ estado: "UNIDA", unidaAMesa: 3, cuentas: [] }));
    expect(m).toMatchObject({ modo: "SOLO_LECTURA", unida: "Unida a la mesa 3", cuentaId: null });
  });

  it("mesa dividida (cuentas hijas): solo lectura con sus cuentas; sin acciones", () => {
    const m = armarLaMesa(
      {},
      ficha({
        estado: "OCUPADA",
        cuentas: [
          { cuentaId: "h1", parte: 1, total: ARS("100.00"), lineas: [] },
          { cuentaId: "h2", parte: 2, total: ARS("2500.5"), lineas: [] },
        ],
      }),
    );
    expect(m).toMatchObject({
      modo: "SOLO_LECTURA",
      cuentaId: null,
      cuentasHijas: ["Cuenta 1 · $ 100,00", "Cuenta 2 · $ 2.500,50"],
    });
  });

  it("ante lo que no conoce (estado raro, dos cuentas sin ser hijas, una hija sola) no se ofrece nada", () => {
    expect(armarLaMesa({}, ficha({ estado: "RARO" })).modo).toBe("SOLO_LECTURA");
    const unica = ficha().cuentas[0];
    if (unica === undefined) throw new Error("falta la cuenta");
    expect(armarLaMesa({}, ficha({ cuentas: [unica, { ...unica, cuentaId: "c2" }] })).modo).toBe(
      "SOLO_LECTURA",
    );
    expect(armarLaMesa({}, ficha({ cuentas: [{ ...unica, parte: 1 }] })).modo).toBe("SOLO_LECTURA");
    expect(armarLaMesa({}, ficha({ estado: "LIBRE", cuentas: [unica] })).modo).toBe("SOLO_LECTURA");
  });

  it("una moneda que no es ARS no se muestra como pesos", () => {
    const f = ficha();
    const unica = f.cuentas[0];
    if (unica === undefined) throw new Error("falta la cuenta");
    expect(
      armarLaMesa({}, { ...f, cuentas: [{ ...unica, total: { moneda: "USD", monto: "10.00" } }] })
        .total,
    ).toBeNull();
  });
});

describe("mesasLibresParaElCambio", () => {
  it("solo las libres, sin la actual, por número", () => {
    const mesas = [
      { mesaId: "a", numero: 12, estado: "LIBRE" },
      { mesaId: "b", numero: 3, estado: "OCUPADA" },
      { mesaId: "c", numero: 5, estado: "LIBRE" },
      { mesaId: "d", numero: 1, estado: "LIBRE" },
      { mesaId: "e", numero: 9, estado: "UNIDA" },
    ];
    expect(mesasLibresParaElCambio({}, mesas, "d")).toEqual([
      { id: "c", titulo: "Mesa 5" },
      { id: "a", titulo: "Mesa 12" },
    ]);
  });
});

describe("textosDeLaMesa", () => {
  it("son los aprobados del catálogo", () => {
    expect(textosDeLaMesa()).toMatchObject({
      mesaLibre: "Mesa libre",
      tomarPedido: "Tomar pedido",
      sinPedido: "La mesa no tiene pedido",
      liberar: "Liberar mesa",
      cambiarDeMesa: "Cambiar de mesa",
      pasarALaMesa: "Pasar a la mesa",
      noHayMesasLibres: "No hay mesas libres",
      agregar: "Agregar",
      total: "Total",
      cuandoSale: "Cuándo sale",
      saleAhora: "Sale ahora",
      saleDespues: "Sale después",
      quitar: "Quitar",
    });
  });
});

import { describe, expect, it } from "vitest";
import { ESTADOS_DEL_FILTRO_DE_ORDENES } from "../../src/composicion/entradas-de-produccion";
import { CLAVE_DE_TEXTO_DE_UNIDAD } from "../../src/capacidades/vocabulario/unidades-de-medida";
import {
  ESTADOS_DEL_FILTRO,
  RUTA_DE_PRODUCCION,
  direccionDeLaLista,
  leerElFiltroDeEstado,
  rutaDeLaOrden,
} from "../../apps/web/ui/plantillas/produccion/filtros-de-ordenes";
import {
  armarLaOrden,
  type OrdenDeLaFicha,
} from "../../apps/web/ui/plantillas/produccion/modelo-de-orden";
import {
  armarLaLista,
  cantidadConUnidad,
  marcaDeEstado,
  type OrdenesDeLaLista,
} from "../../apps/web/ui/plantillas/produccion/modelo-de-ordenes";

/**
 * El modelo de vista de la lista y de la ficha de las órdenes de producción (maqueta `produccion.html`, 09/11/2026), con los textos reales del catálogo: cada fila y cada dato dicen lo que la
 * maqueta dice con los textos ya aprobados, los filtros se leen de la dirección y vuelven a ella, y los botones nacen cerrados. Previene: una opción del filtro que la composición no
 * acepta, un estado o una unidad sin texto, un importe o una cantidad que pase por `Number`.
 */
const ID = "11111111-1111-4111-8111-111111111111";

describe("el filtro de la lista", () => {
  it("las opciones de la pantalla son las que acepta la composición, en el mismo orden", () => {
    expect([...ESTADOS_DEL_FILTRO]).toEqual([...ESTADOS_DEL_FILTRO_DE_ORDENES]);
  });

  it("se lee de la dirección; lo que no es una opción conocida vuelve a «Todas»", () => {
    expect(leerElFiltroDeEstado({})).toBe("");
    expect(leerElFiltroDeEstado({ estado: "ABIERTA" })).toBe("ABIERTA");
    expect(leerElFiltroDeEstado({ estado: ["ABIERTA", "CERRADA"] })).toBe("ABIERTA");
    expect(leerElFiltroDeEstado({ estado: ["CERRADA", "ABIERTA"] })).toBe("");
    for (const raro of ["CERRADA", "abierta", "", "toString", "__proto__", " ABIERTA"]) {
      expect(leerElFiltroDeEstado({ estado: raro })).toBe("");
    }
    expect(leerElFiltroDeEstado({ estado: [] })).toBe("");
  });

  it("las direcciones: la lista, la lista filtrada y la ficha de una orden", () => {
    expect(RUTA_DE_PRODUCCION).toBe("/catalogo/produccion");
    expect(direccionDeLaLista("")).toBe("/catalogo/produccion");
    expect(direccionDeLaLista("ABIERTA")).toBe("/catalogo/produccion?estado=ABIERTA");
    expect(rutaDeLaOrden(ID)).toBe(`/catalogo/produccion/${ID}`);
  });
});

describe("marcaDeEstado y cantidadConUnidad", () => {
  it.each([
    ["ABIERTA", "Abierta", "info"],
    ["CERRADA", "Cerrada", "exito"],
    ["CANCELADA", "Cancelada", "neutro"],
    ["ANULADA", "Anulada", "aviso"],
  ])("%s dice «%s» con el tono %s", (estado, texto, tono) => {
    expect(marcaDeEstado(estado)).toEqual({ texto, tono });
  });

  it("un estado que la pantalla no conoce se dice con el propio valor, sin tono (nunca se esconde)", () => {
    expect(marcaDeEstado("NUEVO")).toEqual({ texto: "NUEVO", tono: "neutro" });
    expect(marcaDeEstado("toString")).toEqual({ texto: "toString", tono: "neutro" });
  });

  it("la cantidad es texto decimal con coma y miles, sin ceros de más, y lleva el nombre de la unidad", () => {
    expect(cantidadConUnidad("10.0000", "KILOGRAMO")).toBe("10 Kilogramo");
    expect(cantidadConUnidad("0.4000", "LITRO")).toBe("0,4 Litro");
    expect(cantidadConUnidad("1234567.5000", "UNIDAD")).toBe("1.234.567,5 Unidad");
    expect(cantidadConUnidad("12345678901234567890.1234", "GRAMO")).toBe(
      "12.345.678.901.234.567.890,1234 Gramo",
    );
  });

  it("cada unidad conocida tiene su nombre; una desconocida se dice con su código y sin unidad, solo la cantidad", () => {
    for (const unidad of Object.keys(CLAVE_DE_TEXTO_DE_UNIDAD)) {
      expect(cantidadConUnidad("2", unidad)).not.toBe("2 ");
      expect(cantidadConUnidad("2", unidad)).not.toContain(unidad);
    }
    expect(cantidadConUnidad("2", "BOLSA")).toBe("2 BOLSA");
    expect(cantidadConUnidad("2", "")).toBe("2");
    expect(cantidadConUnidad("2", "toString")).toBe("2 toString");
  });
});

describe("armarLaLista", () => {
  const lista: OrdenesDeLaLista = {
    ordenes: [
      {
        id: ID,
        numero: 14,
        estado: "ABIERTA",
        nombre: "Masa de medialuna",
        cantidad: "10.0000",
        unidadId: "KILOGRAMO",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        numero: 13,
        estado: "CERRADA",
        nombre: "Medialuna",
        cantidad: "100.0000",
        unidadId: "UNIDAD",
      },
    ],
  };

  it("cada fila dice «Orden N · producto», su estado en texto, su cantidad con unidad y lleva a su ficha", () => {
    expect(armarLaLista(lista, "").filas).toEqual([
      {
        id: ID,
        href: `/catalogo/produccion/${ID}`,
        titulo: "Orden 14 · Masa de medialuna",
        estado: { texto: "Abierta", tono: "info" },
        cantidad: "10 Kilogramo",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        href: "/catalogo/produccion/22222222-2222-4222-8222-222222222222",
        titulo: "Orden 13 · Medialuna",
        estado: { texto: "Cerrada", tono: "exito" },
        cantidad: "100 Unidad",
      },
    ]);
    expect(armarLaLista(lista, "").vacio).toBeNull();
  });

  it("los filtros son enlaces «Todas» y «Abiertas»; el actual es el que se pidió", () => {
    expect(armarLaLista(lista, "").filtros).toEqual([
      { href: "/catalogo/produccion", texto: "Todas", actual: true },
      { href: "/catalogo/produccion?estado=ABIERTA", texto: "Abiertas", actual: false },
    ]);
    expect(armarLaLista(lista, "ABIERTA").filtros.map((f) => f.actual)).toEqual([false, true]);
  });

  it("«Nueva orden» sale solo si el servidor ofrece abrir (cualquier otra cosa, no)", () => {
    expect(armarLaLista(lista, "", {}, { abrir: true }).nueva).toEqual({
      href: "/catalogo/produccion/nueva",
      texto: "Nueva orden",
    });
    expect(armarLaLista(lista, "").nueva).toBeNull();
    expect(armarLaLista(lista, "", {}, {}).nueva).toBeNull();
    expect(armarLaLista(lista, "", {}, { abrir: false }).nueva).toBeNull();
    expect(armarLaLista(lista, "", {}, { abrir: undefined }).nueva).toBeNull();
  });

  it("sin órdenes, «Sin resultados»", () => {
    expect(armarLaLista({ ordenes: [] }, "ABIERTA")).toMatchObject({
      filas: [],
      vacio: "Sin resultados",
    });
  });
});

describe("armarLaOrden", () => {
  const abierta: OrdenDeLaFicha = {
    id: ID,
    numero: 14,
    estado: "ABIERTA",
    nombre: "Masa de medialuna",
    unidadId: "KILOGRAMO",
    cantidadEsperada: "10.0000",
    cantidadObtenida: null,
    mermaDeLote: null,
    recetaCambiada: false,
    vence: null,
    lote: null,
    renglones: [
      { nombre: "Harina 000", esperado: "6.0000", real: null, unidadId: "KILOGRAMO" },
      { nombre: "Agua", esperado: "1.2000", real: null, unidadId: "LITRO" },
    ],
  };
  const cerrada: OrdenDeLaFicha = {
    ...abierta,
    estado: "CERRADA",
    cantidadObtenida: "9.5000",
    mermaDeLote: "0.5000",
    vence: "2026-12-01",
    lote: "OP-14",
    renglones: [
      { nombre: "Harina 000", esperado: "6.0000", real: "6.2000", unidadId: "KILOGRAMO" },
      { nombre: "Agua", esperado: "1.2000", real: "0.0000", unidadId: "LITRO" },
    ],
    costo: { costoUnitario: "2833.333333", costoEstado: "DEFINITIVO" },
  };
  const nadie = { cancelar: false, anular: false };
  const todo = { cancelar: true, anular: true };

  it("una orden abierta: «Orden N», su estado, el producto con lo esperado y «Consume» con lo esperado; sin lote, vencimiento ni costo", () => {
    const o = armarLaOrden(abierta, nadie);
    expect(o.titulo).toBe("Orden 14");
    expect(o.estado).toEqual({ texto: "Abierta", tono: "info" });
    expect(o.producto).toEqual({ nombre: "Masa de medialuna", cantidad: "10 Kilogramo" });
    expect(o.datos).toEqual([]);
    expect(o.avisoDeReceta).toBeNull();
    expect(o.consume).toEqual({
      titulo: "Consume",
      filas: [
        { nombre: "Harina 000", cantidad: "6 Kilogramo" },
        { nombre: "Agua", cantidad: "1,2 Litro" },
      ],
    });
  });

  it("una orden cerrada: lo obtenido, el lote, el vencimiento en DD/MM/AAAA, el costo por unidad con formato y «Consume» con lo real (cero incluido)", () => {
    const o = armarLaOrden(cerrada, nadie);
    expect(o.estado).toEqual({ texto: "Cerrada", tono: "exito" });
    expect(o.producto.cantidad).toBe("9,5 Kilogramo");
    expect(o.datos).toEqual([
      { rotulo: "Lote", valor: "OP-14" },
      { rotulo: "Vence", valor: "01/12/2026" },
      { rotulo: "Costo por unidad", valor: "$ 2.833,33" },
      { rotulo: "Esperado 10 · obtenido 9,5", valor: "− 0,5 Kilogramo" },
    ]);
    expect(o.consume.titulo).toBe("Consumió");
    expect(o.consume.filas).toEqual([
      { nombre: "Harina 000", cantidad: "6,2 Kilogramo" },
      { nombre: "Agua", cantidad: "0 Litro" },
    ]);
  });

  it("una orden anulada se ve igual que la cerrada, con su estado", () => {
    const o = armarLaOrden({ ...cerrada, estado: "ANULADA" }, todo);
    expect(o.estado).toEqual({ texto: "Anulada", tono: "aviso" });
    expect(o.producto.cantidad).toBe("9,5 Kilogramo");
    expect(o.datos.map((d) => d.rotulo)).toEqual([
      "Lote",
      "Vence",
      "Costo por unidad",
      "Esperado 10 · obtenido 9,5",
    ]);
    expect(o.accion).toBeNull();
  });

  it("una orden cancelada se ve con lo esperado, sin lote ni costo, y sin botones", () => {
    const o = armarLaOrden({ ...abierta, estado: "CANCELADA" }, todo);
    expect(o.estado).toEqual({ texto: "Cancelada", tono: "neutro" });
    expect(o.producto.cantidad).toBe("10 Kilogramo");
    expect(o.datos).toEqual([]);
    expect(o.accion).toBeNull();
  });

  it("lo cerrado solo se ve en una cerrada o anulada: una abierta o cancelada no muestra lote, vencimiento, costo ni lo real, aunque la ficha los traiga", () => {
    for (const estado of ["ABIERTA", "CANCELADA"]) {
      const o = armarLaOrden({ ...cerrada, estado }, todo);
      expect(o.datos).toEqual([]);
      expect(o.producto.cantidad).toBe("10 Kilogramo");
      expect(o.consume.filas.map((f) => f.cantidad)).toEqual(["6 Kilogramo", "1,2 Litro"]);
    }
  });

  it("la diferencia de rendimiento (merma de lote) solo se dice si la hay: positiva, no cero ni negativa ni ausente", () => {
    for (const merma of ["0.0000", "0", "-0.5000", null]) {
      const o = armarLaOrden({ ...cerrada, mermaDeLote: merma }, nadie);
      expect(o.datos.some((x) => x.rotulo.startsWith("Esperado"))).toBe(false);
    }
    const sinObtenido = armarLaOrden({ ...cerrada, cantidadObtenida: null }, nadie);
    expect(sinObtenido.datos.some((x) => x.rotulo.startsWith("Esperado"))).toBe(false);
    const chica = armarLaOrden({ ...cerrada, mermaDeLote: "0.0001" }, nadie);
    expect(chica.datos.at(-1)?.valor).toBe("− 0,0001 Kilogramo");
  });

  it("«Orden anulada» solo en una anulada", () => {
    expect(armarLaOrden({ ...cerrada, estado: "ANULADA" }, nadie).avisoDeAnulada).toBe(
      "Orden anulada",
    );
    for (const estado of ["ABIERTA", "CERRADA", "CANCELADA"]) {
      expect(armarLaOrden({ ...cerrada, estado }, nadie).avisoDeAnulada).toBeNull();
    }
  });

  it("lo que no hay no se inventa: sin lote, sin vencimiento o sin costo (sin `costos.ver`) no hay esa fila", () => {
    const sinLote = armarLaOrden({ ...cerrada, lote: null }, nadie);
    expect(sinLote.datos.map((d) => d.rotulo)).toEqual([
      "Vence",
      "Costo por unidad",
      "Esperado 10 · obtenido 9,5",
    ]);
    const sinVence = armarLaOrden({ ...cerrada, vence: null }, nadie);
    expect(sinVence.datos.map((d) => d.rotulo)).toEqual([
      "Lote",
      "Costo por unidad",
      "Esperado 10 · obtenido 9,5",
    ]);
    const sinCosto: OrdenDeLaFicha = { ...cerrada };
    delete (sinCosto as { costo?: unknown }).costo;
    expect(Object.hasOwn(sinCosto, "costo")).toBe(false);
    expect(armarLaOrden(sinCosto, nadie).datos.map((d) => d.rotulo)).toEqual([
      "Lote",
      "Vence",
      "Esperado 10 · obtenido 9,5",
    ]);
    expect(armarLaOrden({ ...cerrada, costo: undefined }, nadie).datos).toHaveLength(3);
  });

  it("una cerrada sin la cantidad obtenida (no debería pasar) muestra lo esperado; un renglón sin lo real, lo esperado", () => {
    const o = armarLaOrden(
      {
        ...cerrada,
        cantidadObtenida: null,
        renglones: [{ nombre: "Sal", esperado: "0.1000", real: null, unidadId: "KILOGRAMO" }],
      },
      nadie,
    );
    expect(o.producto.cantidad).toBe("10 Kilogramo");
    expect(o.consume.filas).toEqual([{ nombre: "Sal", cantidad: "0,1 Kilogramo" }]);
  });

  it("el costo por unidad se muestra redondeado a 2 decimales (la mitad hacia arriba), sin tocar lo guardado", () => {
    const costo = (costoUnitario: string) =>
      armarLaOrden(
        { ...cerrada, costo: { costoUnitario, costoEstado: "DEFINITIVO" } },
        nadie,
      ).datos.find((x) => x.rotulo === "Costo por unidad")?.valor;
    expect(costo("2833.333333")).toBe("$ 2.833,33");
    expect(costo("2833.336000")).toBe("$ 2.833,34");
    expect(costo("10.005000")).toBe("$ 10,01");
    expect(costo("10.004999")).toBe("$ 10,00");
    expect(costo("10.015000")).toBe("$ 10,02");
    expect(costo("0.005000")).toBe("$ 0,01");
    expect(costo("0.004999")).toBe("$ 0,00");
    expect(costo("0.000000")).toBe("$ 0,00");
    expect(costo("123456789012.995000")).toBe("$ 123.456.789.013,00");
    expect(costo("999999999999.999999")).toBe("$ 1.000.000.000.000,00");
    expect(costo("5")).toBe("$ 5,00");
  });

  it("un costo que no es un precio válido no se redondea ni se inventa: se dice como llegó", () => {
    const o = armarLaOrden(
      { ...cerrada, costo: { costoUnitario: "abc", costoEstado: "DEFINITIVO" } },
      nadie,
    );
    expect(o.datos.find((x) => x.rotulo === "Costo por unidad")?.valor).toBe("$ abc");
  });

  it("el costo sin definir (sin costo cargado) dice «Sin costo», nunca un valor", () => {
    for (const costo of [
      { costoUnitario: null, costoEstado: "SIN_COSTO" },
      { costoUnitario: "10.000000", costoEstado: "SIN_COSTO" },
      { costoUnitario: null, costoEstado: null },
    ]) {
      expect(
        armarLaOrden({ ...cerrada, costo }, nadie).datos.find(
          (x) => x.rotulo === "Costo por unidad",
        ),
      ).toEqual({
        rotulo: "Costo por unidad",
        valor: "Sin costo",
      });
    }
  });

  it("el aviso «La receta cambió desde que abriste la orden» sale solo en una abierta cuya receta cambió", () => {
    expect(armarLaOrden({ ...abierta, recetaCambiada: true }, nadie).avisoDeReceta).toBe(
      "La receta cambió desde que abriste la orden",
    );
    expect(armarLaOrden({ ...cerrada, recetaCambiada: true }, nadie).avisoDeReceta).toBeNull();
    expect(armarLaOrden({ ...abierta, recetaCambiada: false }, nadie).avisoDeReceta).toBeNull();
  });

  it("«Cancelar la orden» solo en una abierta y solo si el servidor deja; la hoja lleva los textos aprobados", () => {
    expect(armarLaOrden(abierta, todo).accion).toEqual({
      tipo: "CANCELAR",
      boton: "Cancelar la orden",
      titulo: "Cancelar la orden 14",
      motivo: "Motivo",
      cancelar: "Cancelar",
      cerrar: "Cerrar",
      explicacion: null,
      sinConexion: "No se puede enviar sin conexión.",
    });
    expect(armarLaOrden(abierta, { cancelar: false, anular: true }).accion).toBeNull();
  });

  it("«Anular la orden» solo en una cerrada y solo si el servidor deja", () => {
    expect(armarLaOrden(cerrada, todo).accion).toEqual({
      tipo: "ANULAR",
      boton: "Anular la orden",
      titulo: "Anular la orden 14",
      motivo: "Motivo",
      cancelar: "Cancelar",
      cerrar: "Cerrar",
      explicacion:
        "Se devuelve lo consumido y se saca lo producido. Queda el registro de la orden.",
      sinConexion: "No se puede enviar sin conexión.",
    });
    expect(armarLaOrden(cerrada, { cancelar: true, anular: false }).accion).toBeNull();
  });

  it("los botones nacen cerrados: lo que no sea exactamente `true` no los muestra", () => {
    const dudoso = { cancelar: "true", anular: 1 } as never;
    expect(armarLaOrden(abierta, dudoso).accion).toBeNull();
    expect(armarLaOrden(cerrada, dudoso).accion).toBeNull();
    expect(armarLaOrden(abierta, {} as never).accion).toBeNull();
  });
});

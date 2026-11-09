import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { tienePrecioParaLaCartaEnSucursal } from "../../src/modulos/catalogo/publico";
import {
  CONTEXTO_CON_AHORA,
  cotizarEnTx,
  montarCatalogo,
  nombreAlAzarDeProducto,
  nuevoId,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { empresaId, sucursalId } from "../../src/primitivas/identificadores/marca";

/**
 * `cotizarParaVender` y lo que ventas congela (E2 mínimo §3.6 y §5): el precio vigente de la sucursal con las opciones elegidas, el precio
 * congelado (F1), por sucursal (F2, F7), la cuenta exacta (F3), el precio abierto (F4, F8), la variante sin precio (F5), el precio propio que
 * vuelve al sacar la variante (F6), el aislamiento entre empresas (A1, A3) y la alta rápida que no se vende (D2).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("catálogo: cotizar para vender", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const crear = async (extra: Record<string, unknown> = {}) =>
    valorDe(
      await c.casos.crearProducto(e.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "UNIDAD",
        alicuota: "21",
        ...extra,
      }),
    ).productoId;
  const ultimo = async (productoId: string, opcionId: string | null, sucursal: string | null) =>
    ((
      await c.filas(
        "select id from precio_de_venta where producto_id = $1 and opcion_id is not distinct from $2::uuid and sucursal_id is not distinct from $3::uuid order by vigente_desde desc limit 1",
        [productoId, opcionId, sucursal],
      )
    )[0]?.["id"] as string | undefined) ?? null;
  const precio = async (
    productoId: string,
    precio: string | null,
    extra: { opcionId?: string; sucursalId?: string; contexto?: ContextoOperativo } = {},
  ) =>
    valorDe(
      await c.casos.cambiarPrecio(extra.contexto ?? e.gerente, {
        precioId: nuevoId(),
        productoId,
        opcionId: extra.opcionId ?? null,
        sucursalId: extra.sucursalId ?? null,
        precioIdEsperado: await ultimo(
          productoId,
          extra.opcionId ?? null,
          extra.sucursalId ?? null,
        ),
        precio,
      }),
    ).precioId;
  const version = async (id: string) =>
    Number(
      (await c.filas("select version_de_opciones as v from producto where id = $1", [id]))[0]?.[
        "v"
      ],
    );
  const cotizar = (
    productoId: string,
    extra: { opcionIds?: string[]; sucursal?: string; cantidad?: string; ahora?: Date } = {},
  ) =>
    cotizarEnTx(c, e.gerente, {
      sucursalId: extra.sucursal ?? e.sucursal,
      productoId,
      ...(extra.opcionIds === undefined ? {} : { opcionIds: extra.opcionIds }),
      ...(extra.cantidad === undefined ? {} : { cantidad: extra.cantidad }),
      ...(extra.ahora === undefined ? {} : { ahora: extra.ahora }),
    });

  /** Un café con tamaños (chico 3.000, grande 4.000) y el adicional «leche de almendras» (+600). */
  const cafe = async () => {
    const id = await crear({ nombre: nombreAlAzarDeProducto("Cafe") });
    const tam = {
      id: nuevoId(),
      clase: "VARIANTE",
      esTamano: true,
      nombre: "Tamaño",
      esObligatorio: true,
      admiteVarias: false,
      seMuestraEnCarta: true,
      orden: 0,
      activo: true,
      opciones: [
        { id: nuevoId(), nombre: "Chico", recargo: "0", orden: 1, activa: true },
        {
          id: nuevoId(),
          nombre: "Grande",
          recargo: "0",
          orden: 2,
          activa: true,
          factorDeTamano: "1.5",
        },
      ],
    };
    const extras = {
      id: nuevoId(),
      clase: "ADICIONAL",
      nombre: "Extras",
      esObligatorio: false,
      admiteVarias: true,
      seMuestraEnCarta: true,
      orden: 1,
      activo: true,
      opciones: [
        { id: nuevoId(), nombre: "Leche de almendras", recargo: "600", orden: 1, activa: true },
      ],
    };
    valorDe(
      await c.casos.editarOpciones(e.gerente, {
        productoId: id,
        versionDeOpcionesEsperada: 0,
        grupos: [tam, extras],
      }),
    );
    const [chico, grande] = tam.opciones.map((o) => o.id) as [string, string];
    await precio(id, "3000", { opcionId: chico });
    await precio(id, "4000", { opcionId: grande });
    return { id, tam, extras, chico, grande, almendras: extras.opciones[0]?.id as string };
  };

  it("F3: chico + adicional = 3.600 y grande + adicional = 4.600, suma exacta como texto, con lo que ventas congela en la línea", async () => {
    const k = await cafe();
    const chico = await cotizar(k.id, { opcionIds: [k.chico, k.almendras] });
    expect(chico).toMatchObject({
      ok: true,
      valor: {
        productoId: k.id,
        descripcion: expect.any(String) as string,
        claseDeUso: "VENDIBLE",
        alicuota: "21",
        origenDelPrecio: "EMPRESA",
        moneda: "ARS",
        precioBase: "3000.000000",
        precioUnitario: "3600.000000",
        unidadDeVentaId: "UNIDAD",
        pasoMinimo: "1.0000",
        cantidad: "1.0000",
        emisorExclusivoId: null,
        variante: { opcionId: k.chico, nombre: "Chico", esTamano: true, factorDeTamano: "1.0000" },
        opciones: [
          {
            opcionId: k.almendras,
            nombre: "Leche de almendras",
            clase: "ADICIONAL",
            recargo: "600.000000",
            origenDelRecargo: "EMPRESA",
            seMuestraEnCarta: true,
          },
        ],
      },
    });
    expect(await cotizar(k.id, { opcionIds: [k.grande, k.almendras] })).toMatchObject({
      ok: true,
      valor: { precioUnitario: "4600.000000", variante: { factorDeTamano: "1.5000" } },
    });
    expect(await cotizar(k.id, { opcionIds: [k.grande] })).toMatchObject({
      ok: true,
      valor: { precioUnitario: "4000.000000", opciones: [] },
    });
  });

  it("F1: el precio y la versión sellados en la línea no cambian aunque cambien después los precios, el recargo y el consumo; recotizar da lo nuevo y lo sellado no se puede tocar", async () => {
    const k = await cafe();
    const ahora = new Date("2026-10-12T10:00:00Z");
    const sellada = valorDe(await cotizar(k.id, { opcionIds: [k.chico, k.almendras], ahora }));
    expect(sellada.precioUnitario).toBe("3600.000000");
    const [precioId, versionDeLaOpcion, versionDeLaVariante] = [
      sellada.precioId as string,
      sellada.opciones[0]?.versionDeOpcionId as string,
      sellada.variante?.versionDeOpcionId as string,
    ];
    // Cambian: el precio de la empresa, el de una sucursal, el recargo de la empresa y el de una sucursal, y el consumo de la opción.
    const despues = CONTEXTO_CON_AHORA(e.gerente, "2026-10-13T00:00:00Z");
    await precio(k.id, "3500", { opcionId: k.chico, contexto: despues });
    await precio(k.id, "3900", { opcionId: k.chico, sucursalId: e.sucursal, contexto: despues });
    await precio(k.id, "700", { opcionId: k.almendras, sucursalId: e.sucursal, contexto: despues });
    const harina = valorDe(
      await c.casos.crearProductoRapido(e.gerente, {
        id: nuevoId(),
        claseDeUso: "MATERIA_PRIMA",
        nombre: nombreAlAzarDeProducto("Almendra"),
        unidadBaseId: "KILOGRAMO",
      }),
    ).productoId;
    valorDe(
      await c.casos.editarOpciones(e.gerente, {
        productoId: k.id,
        versionDeOpcionesEsperada: await version(k.id),
        grupos: [
          k.tam,
          {
            ...k.extras,
            opciones: [
              {
                ...(k.extras.opciones[0] as NonNullable<(typeof k.extras.opciones)[0]>),
                recargo: "650",
              },
            ],
          },
        ],
      }),
    );
    valorDe(
      await c.casos.guardarConsumoDeGrupo(e.gerente, {
        productoId: k.id,
        versionDeOpcionesEsperada: await version(k.id),
        grupoId: k.extras.id,
        opciones: [
          {
            opcionId: k.almendras,
            lineas: [{ insumoId: harina, cantidad: "0.05", escalaConTamano: true }],
          },
        ],
      }),
    );
    // Lo sellado: leído por `precioId` y `versionDeOpcionId`, salen los valores viejos.
    expect(
      (
        await c.filas("select precio::text as precio from precio_de_venta where id = $1", [
          precioId,
        ])
      )[0]?.["precio"],
    ).toBe("3000.000000");
    expect(
      (
        await c.filas("select recargo::text as recargo from version_de_opcion where id = $1", [
          versionDeLaOpcion,
        ])
      )[0]?.["recargo"],
    ).toBe("600.000000");
    expect(
      await c.contar(
        "select count(*) as n from consumo_de_opcion where version_de_opcion_id = $1",
        [versionDeLaOpcion],
      ),
    ).toBe(0);
    expect(
      (
        await c.filas("select factor_de_tamano::text as f from version_de_opcion where id = $1", [
          versionDeLaVariante,
        ])
      )[0]?.["f"],
    ).toBe("1.0000");
    // Recotizar da los valores nuevos (sucursal 3.900 + recargo propio 700).
    expect(
      await cotizar(k.id, {
        opcionIds: [k.chico, k.almendras],
        ahora: new Date("2026-10-13T00:00:00Z"),
      }),
    ).toMatchObject({
      ok: true,
      valor: {
        precioBase: "3900.000000",
        precioUnitario: "4600.000000",
        origenDelPrecio: "SUCURSAL",
        opciones: [
          {
            recargo: "700.000000",
            origenDelRecargo: "SUCURSAL",
            versionDeOpcionId: expect.not.stringMatching(versionDeLaOpcion) as string,
          },
        ],
      },
    });
    // Cotizar «hacia atrás» con la fecha de la línea sigue dando lo de entonces (el precio es por instante).
    expect(await cotizar(k.id, { opcionIds: [k.chico], ahora })).toMatchObject({
      ok: true,
      valor: { precioUnitario: "3000.000000", precioId },
    });
    // Las filas selladas no se pueden modificar ni borrar (ni el dueño de la base).
    for (const sentencia of [
      "update precio_de_venta set precio = 1 where id = $1",
      "delete from precio_de_venta where id = $1",
    ]) {
      await expect(c.dueno.query(sentencia, [precioId])).rejects.toMatchObject({ code: "42501" });
    }
    for (const sentencia of [
      "update version_de_opcion set nombre = 'x' where id = $1",
      "delete from version_de_opcion where id = $1",
    ]) {
      await expect(c.dueno.query(sentencia, [versionDeLaOpcion])).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  it("F2: cada sucursal cotiza el suyo (origen SUCURSAL / EMPRESA) y «volver al de la empresa» hace regir el de la empresa sin borrar el historial", async () => {
    const id = await crear();
    await precio(id, "3200");
    const propio = await precio(id, "3600", { sucursalId: e.sucursal });
    expect(await cotizar(id, { ahora: new Date("2026-10-12T00:00:00Z") })).toMatchObject({
      ok: true,
      valor: { origenDelPrecio: "SUCURSAL", precioUnitario: "3600.000000", precioId: propio },
    });
    expect(await cotizar(id, { sucursal: e.otraSucursal })).toMatchObject({
      ok: true,
      valor: { origenDelPrecio: "EMPRESA", precioUnitario: "3200.000000" },
    });
    await precio(id, null, { sucursalId: e.sucursal });
    expect(await cotizar(id, { ahora: new Date("2026-10-13T00:00:00Z") })).toMatchObject({
      ok: true,
      valor: { origenDelPrecio: "EMPRESA", precioUnitario: "3200.000000" },
    });
    expect(
      await c.contar("select count(*) as n from precio_de_venta where producto_id = $1", [id]),
    ).toBe(3);
  });

  it("F7: adicional con recargo de la empresa 600 y propio de una sucursal 800; al quitarlo vuelve a 600 y el historial conserva todo", async () => {
    const k = await cafe();
    await precio(k.id, "800", { opcionId: k.almendras, sucursalId: e.sucursal });
    const en = (sucursal: string, dia: string) =>
      cotizar(k.id, {
        opcionIds: [k.chico, k.almendras],
        sucursal,
        ahora: new Date(`2026-10-${dia}T00:00:00Z`),
      });
    expect(await en(e.sucursal, "12")).toMatchObject({
      ok: true,
      valor: {
        precioUnitario: "3800.000000",
        opciones: [{ recargo: "800.000000", origenDelRecargo: "SUCURSAL" }],
      },
    });
    expect(await en(e.otraSucursal, "12")).toMatchObject({
      ok: true,
      valor: {
        precioUnitario: "3600.000000",
        opciones: [{ recargo: "600.000000", origenDelRecargo: "EMPRESA" }],
      },
    });
    await precio(k.id, null, { opcionId: k.almendras, sucursalId: e.sucursal });
    expect(await en(e.sucursal, "13")).toMatchObject({
      ok: true,
      valor: {
        precioUnitario: "3600.000000",
        opciones: [{ recargo: "600.000000", origenDelRecargo: "EMPRESA" }],
      },
    });
    expect(
      await c.contar("select count(*) as n from precio_de_venta where opcion_id = $1", [
        k.almendras,
      ]),
    ).toBe(2);
  });

  it("F4 y F8: sin precio es precio abierto y SE VENDE, pero no se muestra en la carta; con precio sí; con variante solo cuentan los tamaños con precio", async () => {
    const id = await crear();
    const enCarta = (productoId: string, sucursal = e.sucursal, dia = "12") =>
      c.entorno
        .ejecutar(
          { contexto: e.gerente, aislamiento: "read committed", soloLectura: true },
          async (tx) => ({
            ok: true as const,
            valor: await tienePrecioParaLaCartaEnSucursal(tx, {
              empresaId: empresaId(e.empresa),
              productoId,
              sucursalId: sucursalId(sucursal),
              ahora: new Date(`2026-10-${dia}T00:00:00Z`),
            }),
          }),
        )
        .then(valorDe);
    expect(await cotizar(id)).toMatchObject({
      ok: true,
      valor: { origenDelPrecio: "ABIERTO", precioId: null, precioBase: null, precioUnitario: null },
    });
    expect(await enCarta(id)).toBe(false);
    await precio(id, "100");
    expect(await enCarta(id, e.sucursal, "13")).toBe(true);
    // Con variante: sin ningún precio de tamaño, no se muestra; con uno, sí.
    const conTamano = await crear();
    const tam = {
      id: nuevoId(),
      clase: "VARIANTE",
      esTamano: true,
      nombre: "Tamaño",
      esObligatorio: true,
      admiteVarias: false,
      seMuestraEnCarta: true,
      orden: 0,
      activo: true,
      opciones: [
        { id: nuevoId(), nombre: "Chico", recargo: "0", orden: 1, activa: true },
        { id: nuevoId(), nombre: "Grande", recargo: "0", orden: 2, activa: true },
      ],
    };
    valorDe(
      await c.casos.editarOpciones(e.gerente, {
        productoId: conTamano,
        versionDeOpcionesEsperada: 0,
        grupos: [tam],
      }),
    );
    expect(await enCarta(conTamano)).toBe(false);
    await precio(conTamano, "50", { opcionId: tam.opciones[1]?.id as string });
    expect(await enCarta(conTamano, e.sucursal, "13")).toBe(true);
  });

  it("F5: variante sin precio para el tamaño elegido; sin elegir la variante, opciones incompletas", async () => {
    const id = await crear();
    const tam = {
      id: nuevoId(),
      clase: "VARIANTE",
      esTamano: true,
      nombre: "Tamaño",
      esObligatorio: true,
      admiteVarias: false,
      seMuestraEnCarta: true,
      orden: 0,
      activo: true,
      opciones: [{ id: nuevoId(), nombre: "Chico", recargo: "0", orden: 1, activa: true }],
    };
    valorDe(
      await c.casos.editarOpciones(e.gerente, {
        productoId: id,
        versionDeOpcionesEsperada: 0,
        grupos: [tam],
      }),
    );
    expect(await cotizar(id, { opcionIds: [tam.opciones[0]?.id as string] })).toEqual({
      ok: false,
      error: "VARIANTE_SIN_PRECIO",
    });
    expect(await cotizar(id)).toEqual({
      ok: false,
      error: { error: "OPCIONES_INCOMPLETAS", grupoId: tam.id },
    });
  });

  it("F6: agregar tamaños a un producto con precio propio y después quitarlos: el precio propio queda como historial inerte y vuelve al desactivar la variante (R-18)", async () => {
    const id = await crear();
    await precio(id, "100");
    const tam = {
      id: nuevoId(),
      clase: "VARIANTE",
      esTamano: true,
      nombre: "Tamaño",
      esObligatorio: true,
      admiteVarias: false,
      seMuestraEnCarta: true,
      orden: 0,
      activo: true,
      opciones: [{ id: nuevoId(), nombre: "Chico", recargo: "0", orden: 1, activa: true }],
    };
    valorDe(
      await c.casos.editarOpciones(e.gerente, {
        productoId: id,
        versionDeOpcionesEsperada: 0,
        grupos: [tam],
      }),
    );
    // Con la variante activa el precio propio no rige: hay que elegir tamaño y el tamaño no tiene precio.
    expect(await cotizar(id, { opcionIds: [tam.opciones[0]?.id as string] })).toEqual({
      ok: false,
      error: "VARIANTE_SIN_PRECIO",
    });
    expect(
      await c.casos.cambiarPrecio(e.gerente, {
        precioId: nuevoId(),
        productoId: id,
        opcionId: null,
        sucursalId: null,
        precioIdEsperado: await ultimo(id, null, null),
        precio: "120",
      }),
    ).toEqual({ ok: false, error: "PRECIO_DE_PRODUCTO_CON_VARIANTE" });
    valorDe(
      await c.casos.editarOpciones(e.gerente, {
        productoId: id,
        versionDeOpcionesEsperada: 1,
        grupos: [{ ...tam, activo: false }],
      }),
    );
    expect(await cotizar(id)).toMatchObject({
      ok: true,
      valor: { origenDelPrecio: "EMPRESA", precioUnitario: "100.000000", variante: null },
    });
  });

  it("D2: la alta rápida no cotiza (PRODUCTO_SIN_ALICUOTA) hasta completarla; un insumo, un desactivado y una sucursal cerrada tampoco", async () => {
    const id = valorDe(
      await c.casos.crearProductoRapido(e.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "UNIDAD",
      }),
    ).productoId;
    expect(await cotizar(id)).toEqual({ ok: false, error: "PRODUCTO_SIN_ALICUOTA" });
    const nombre = String(
      (await c.filas("select nombre from producto where id = $1", [id]))[0]?.["nombre"],
    );
    valorDe(
      await c.casos.editarProducto(e.gerente, {
        productoId: id,
        versionEsperada: 1,
        nombre,
        alicuota: "21",
      }),
    );
    expect(await cotizar(id)).toMatchObject({ ok: true });
    const insumo = valorDe(
      await c.casos.crearProductoRapido(e.gerente, {
        id: nuevoId(),
        claseDeUso: "INSUMO",
        nombre: nombreAlAzarDeProducto("Sal"),
        unidadBaseId: "KILOGRAMO",
      }),
    ).productoId;
    expect(await cotizar(insumo)).toEqual({ ok: false, error: "PRODUCTO_NO_VENDIBLE" });
    valorDe(await c.casos.desactivarProducto(e.gerente, { productoId: id }));
    expect(await cotizar(id)).toEqual({ ok: false, error: "PRODUCTO_INACTIVO" });
    const otra = await crear();
    await c.dueno.query("update sucursal set activa = false where id = $1", [e.otraSucursal]);
    expect(await cotizar(otra, { sucursal: e.otraSucursal })).toEqual({
      ok: false,
      error: "SUCURSAL_INACTIVA",
    });
    await c.dueno.query("update sucursal set activa = true where id = $1", [e.otraSucursal]);
  });

  it("la cantidad es texto decimal exacto, mayor que cero y múltiplo del paso: con paso 1 no pasan 0,5, 1,5, cero, negativos ni basura", async () => {
    const id = await crear();
    for (const mala of ["0.5", "1.5", "0", "-1", "abc", "", "1e2"]) {
      const r = await cotizar(id, { cantidad: mala });
      expect(r.ok, mala).toBe(false);
    }
    expect(await cotizar(id, { cantidad: "0.5" })).toEqual({
      ok: false,
      error: "CANTIDAD_NO_ES_MULTIPLO_DEL_PASO",
    });
    expect(await cotizar(id, { cantidad: "abc" })).toEqual({
      ok: false,
      error: "CANTIDAD_INVALIDA",
    });
    expect(await cotizar(id, { cantidad: "3" })).toMatchObject({
      ok: true,
      valor: { cantidad: "3.0000" },
    });
  });

  it("opciones: repetidas, ajenas, inactivas o de más; las de un grupo oculto se aceptan y se devuelven (82)", async () => {
    const k = await cafe();
    const oculto = {
      id: nuevoId(),
      clase: "INCLUIDA",
      nombre: "Para cocina",
      esObligatorio: false,
      admiteVarias: true,
      seMuestraEnCarta: false,
      orden: 2,
      activo: true,
      opciones: [{ id: nuevoId(), nombre: "Sin azucar", recargo: "0", orden: 1, activa: true }],
    };
    valorDe(
      await c.casos.editarOpciones(e.gerente, {
        productoId: k.id,
        versionDeOpcionesEsperada: await version(k.id),
        grupos: [k.tam, k.extras, oculto],
      }),
    );
    expect(await cotizar(k.id, { opcionIds: [k.chico, k.chico] })).toEqual({
      ok: false,
      error: "OPCION_REPETIDA",
    });
    expect(await cotizar(k.id, { opcionIds: [k.chico, nuevoId()] })).toMatchObject({
      ok: false,
      error: { error: "OPCION_INVALIDA" },
    });
    expect(await cotizar(k.id, { opcionIds: [k.chico, k.grande] })).toEqual({
      ok: false,
      error: { error: "OPCIONES_DE_MAS", grupoId: k.tam.id },
    });
    expect(
      await cotizar(k.id, { opcionIds: [k.chico, oculto.opciones[0]?.id as string] }),
    ).toMatchObject({
      ok: true,
      valor: {
        opciones: [
          { nombre: "Sin azucar", clase: "INCLUIDA", seMuestraEnCarta: false, recargo: "0.000000" },
        ],
        precioUnitario: "3000.000000",
      },
    });
  });

  it("A1 y A3: cotizar un producto, una sucursal o una opción de otra empresa da el mismo error que si no existiera", async () => {
    const otra = await c.escenario();
    const k = await cafe();
    const propio = valorDe(
      await c.casos.crearProducto(otra.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "UNIDAD",
        alicuota: "21",
      }),
    ).productoId;
    // La empresa B pide el producto de A.
    expect(
      await cotizarEnTx(c, otra.gerente, {
        sucursalId: otra.sucursal,
        productoId: k.id,
        opcionIds: [k.chico],
      }),
    ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
    expect(
      await cotizarEnTx(c, otra.gerente, { sucursalId: otra.sucursal, productoId: nuevoId() }),
    ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
    // Aunque se le pase la empresa de A en la entrada, la base de B no la ve.
    expect(
      await cotizarEnTx(c, otra.gerente, {
        sucursalId: e.sucursal,
        productoId: k.id,
        empresaId: e.empresa,
      }),
    ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
    // La empresa A con una sucursal de B, o una opción de otro producto.
    expect(await cotizar(k.id, { opcionIds: [k.chico], sucursal: otra.sucursal })).toEqual({
      ok: false,
      error: "SUCURSAL_NO_ENCONTRADA",
    });
    expect(
      await cotizarEnTx(c, otra.gerente, {
        sucursalId: otra.sucursal,
        productoId: propio,
        opcionIds: [k.chico],
      }),
    ).toMatchObject({ ok: false, error: { error: "OPCION_INVALIDA", opcionId: k.chico } });
  });
});

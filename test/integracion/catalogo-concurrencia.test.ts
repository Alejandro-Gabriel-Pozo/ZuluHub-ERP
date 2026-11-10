import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  CONTEXTO_CON_AHORA,
  cotizarEnTx,
  montarCatalogo,
  nombreAlAzarDeProducto,
  nuevoId,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";
import { agotadaEnElResultado, repetirSiAgotada } from "./concurrencia-apoyo";

/**
 * E2 mínimo: concurrencia REAL del catálogo (C1 a C8, más la repetición simultánea I1 a I4). Cada prueba lanza dos transacciones a la vez
 * con una barrera dentro de la transacción (tras leer la autorización) que fuerza que AMBAS hayan empezado antes de que cualquiera escriba.
 * Quien pierde la carrera puede recibir `ConcurrenciaAgotada` (el motor serializable repite 6 veces): se repite el MISMO pedido, seguro por su
 * clave, hasta ver el resultado de fondo. Después se mira la base: nunca hay duplicados ni estados a medias.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 10;

describe.skipIf(base === null)("catálogo: concurrencia de los casos de uso", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base, { formaDeVentaHabilitada: () => true });
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** El pedido se repite si pierde por agotamiento: es el mismo pedido, seguro por su clave. */
  const firme = <R extends { readonly ok: boolean }>(trabajo: () => Promise<R>) =>
    repetirSiAgotada(trabajo, { esAgotada: (r) => agotadaEnElResultado(r as never) });
  /** Dos (o más) pedidos a la vez, con la barrera armada; el orden de salida es el azar del motor, y se alterna cuál sale primero. */
  const aLaVez = async <A, B>(
    pedidos: readonly [() => Promise<A>, () => Promise<B>],
    ronda: number,
  ): Promise<[A, B]> => {
    c.armarBarrera(2);
    try {
      const [a, b] = pedidos;
      if (ronda % 2 === 0) return await Promise.all([a(), b()]);
      const [y, x] = await Promise.all([b(), a()]);
      return [x, y];
    } finally {
      c.soltarBarrera();
    }
  };
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
  const precio = async (
    productoId: string,
    valor: string | null,
    extra: { opcionId?: string; sucursalId?: string } = {},
  ) =>
    valorDe(
      await c.casos.cambiarPrecio(e.gerente, {
        precioId: nuevoId(),
        productoId,
        opcionId: extra.opcionId ?? null,
        sucursalId: extra.sucursalId ?? null,
        precioIdEsperado: await ultimo(
          productoId,
          extra.opcionId ?? null,
          extra.sucursalId ?? null,
        ),
        precio: valor,
      }),
    ).precioId;
  const ultimo = async (productoId: string, opcionId: string | null, sucursal: string | null) =>
    ((
      await c.filas(
        "select id from precio_de_venta where producto_id = $1 and opcion_id is not distinct from $2::uuid and sucursal_id is not distinct from $3::uuid order by vigente_desde desc limit 1",
        [productoId, opcionId, sucursal],
      )
    )[0]?.["id"] as string | undefined) ?? null;
  const contarPrecios = (productoId: string) =>
    c.contar("select count(*) as n from precio_de_venta where producto_id = $1", [productoId]);
  const versionDeOpciones = async (id: string) =>
    Number(
      (await c.filas("select version_de_opciones as v from producto where id = $1", [id]))[0]?.[
        "v"
      ],
    );
  const grupoAdicional = (nombre = nombreAlAzarDeProducto("Extras")) => ({
    id: nuevoId(),
    clase: "ADICIONAL",
    nombre,
    esObligatorio: false,
    admiteVarias: true,
    seMuestraEnCarta: true,
    orden: 1,
    activo: true,
    opciones: [{ id: nuevoId(), nombre: "Queso", recargo: "100", orden: 1, activa: true }],
  });
  const grupoDeTamano = () => ({
    id: nuevoId(),
    clase: "VARIANTE",
    esTamano: true,
    nombre: nombreAlAzarDeProducto("Tamaño"),
    esObligatorio: true,
    admiteVarias: false,
    seMuestraEnCarta: true,
    orden: 0,
    activo: true,
    opciones: [
      { id: nuevoId(), nombre: "Chico", recargo: "0", orden: 1, activa: true },
      { id: nuevoId(), nombre: "Grande", recargo: "0", orden: 2, activa: true },
    ],
  });

  it("C1: dos personas cambian el precio del mismo producto a la vez, viendo el mismo precio anterior: gana UNA, la otra ve PRECIO_DESACTUALIZADO con el precio de la ganadora, y quedan 2 filas", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const id = await crear();
      const inicial = await precio(id, "100");
      const pedido = (valor: string) => () =>
        firme(() =>
          c.casos.cambiarPrecio(e.gerente, {
            precioId: nuevoId(),
            productoId: id,
            opcionId: null,
            sucursalId: null,
            precioIdEsperado: inicial,
            precio: valor,
          }),
        );
      const [a, b] = await aLaVez([pedido("200"), pedido("300")], ronda);
      const ganadoras = [a, b].filter((r) => r.ok);
      expect(ganadoras, `ronda ${ronda}`).toHaveLength(1);
      const perdedora = [a, b].find((r) => !r.ok);
      const precioGanador = a?.ok ? "200.000000" : "300.000000";
      expect(perdedora).toMatchObject({
        ok: false,
        error: { error: "PRECIO_DESACTUALIZADO", vigente: { precio: precioGanador } },
      });
      expect(await contarPrecios(id)).toBe(2);
      const vigente = await ultimo(id, null, null);
      expect(
        (
          await c.filas("select precio::text as p from precio_de_venta where id = $1", [vigente])
        )[0]?.["p"],
      ).toBe(precioGanador);
    }
  });

  it("C2: el precio de la empresa y el de una sucursal a la vez: ganan LOS DOS (cada uno compara con su propio alcance)", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const id = await crear();
      const empresa = await precio(id, "100");
      const sucursal = await precio(id, "150", { sucursalId: e.sucursal });
      const [a, b] = await aLaVez(
        [
          () =>
            firme(() =>
              c.casos.cambiarPrecio(e.gerente, {
                precioId: nuevoId(),
                productoId: id,
                opcionId: null,
                sucursalId: null,
                precioIdEsperado: empresa,
                precio: "110",
              }),
            ),
          () =>
            firme(() =>
              c.casos.cambiarPrecio(e.gerente, {
                precioId: nuevoId(),
                productoId: id,
                opcionId: null,
                sucursalId: e.sucursal,
                precioIdEsperado: sucursal,
                precio: "160",
              }),
            ),
        ],
        ronda,
      );
      expect([a.ok, b.ok], `ronda ${ronda}`).toEqual([true, true]);
      expect(await contarPrecios(id)).toBe(4);
      const cotiza = (s: string) =>
        cotizarEnTx(c, e.gerente, {
          sucursalId: s,
          productoId: id,
          ahora: new Date("2026-10-13T00:00:00Z"),
        });
      expect(await cotiza(e.sucursal)).toMatchObject({
        ok: true,
        valor: { precioUnitario: "160.000000", origenDelPrecio: "SUCURSAL" },
      });
      expect(await cotiza(e.otraSucursal)).toMatchObject({
        ok: true,
        valor: { precioUnitario: "110.000000", origenDelPrecio: "EMPRESA" },
      });
    }
  });

  it("C3: el precio del tamaño chico y el del grande a la vez: ganan LOS DOS", async () => {
    const id = await crear();
    const tam = grupoDeTamano();
    valorDe(
      await c.casos.editarOpciones(e.gerente, {
        productoId: id,
        versionDeOpcionesEsperada: 0,
        grupos: [tam],
      }),
    );
    const [chico, grande] = tam.opciones.map((o) => o.id) as [string, string];
    const inicialChico = await precio(id, "10", { opcionId: chico });
    const inicialGrande = await precio(id, "20", { opcionId: grande });
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const [a, b] = await aLaVez(
        [
          async () =>
            firme(async () =>
              c.casos.cambiarPrecio(e.gerente, {
                precioId: nuevoId(),
                productoId: id,
                opcionId: chico,
                sucursalId: null,
                precioIdEsperado: await ultimo(id, chico, null),
                precio: String(11 + ronda),
              }),
            ),
          async () =>
            firme(async () =>
              c.casos.cambiarPrecio(e.gerente, {
                precioId: nuevoId(),
                productoId: id,
                opcionId: grande,
                sucursalId: null,
                precioIdEsperado: await ultimo(id, grande, null),
                precio: String(21 + ronda),
              }),
            ),
        ],
        ronda,
      );
      expect([a.ok, b.ok], `ronda ${ronda}`).toEqual([true, true]);
    }
    expect(inicialChico && inicialGrande).toBeTruthy();
    expect(await contarPrecios(id)).toBe(2 + 2 * RONDAS);
  });

  it("C4: mientras una le agrega tamaños al producto, otra le pone un precio único: el precio entra antes (y queda como historial inerte) o falla con PRECIO_DE_PRODUCTO_CON_VARIANTE; nunca después de activada la variante", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const id = await crear();
      const tam = grupoDeTamano();
      const [edicion, cambio] = await aLaVez(
        [
          () =>
            firme(() =>
              c.casos.editarOpciones(e.gerente, {
                productoId: id,
                versionDeOpcionesEsperada: 0,
                grupos: [tam],
              }),
            ),
          () =>
            firme(() =>
              c.casos.cambiarPrecio(e.gerente, {
                precioId: nuevoId(),
                productoId: id,
                opcionId: null,
                sucursalId: null,
                precioIdEsperado: null,
                precio: "50",
              }),
            ),
        ],
        ronda,
      );
      expect(edicion.ok, `ronda ${ronda}`).toBe(true);
      if (cambio.ok) {
        // El precio entró ANTES de activarse la variante: queda como historial inerte y la variante exige precio por tamaño.
        expect(await contarPrecios(id)).toBe(1);
        const cot = await cotizarEnTx(c, e.gerente, {
          sucursalId: e.sucursal,
          productoId: id,
          opcionIds: [tam.opciones[0]?.id as string],
        });
        expect(cot).toEqual({ ok: false, error: "VARIANTE_SIN_PRECIO" });
      } else {
        expect(cambio).toEqual({ ok: false, error: "PRECIO_DE_PRODUCTO_CON_VARIANTE" });
        expect(await contarPrecios(id)).toBe(0);
      }
      // El estado final es coherente: con la variante activa ya no se puede escribir un precio del producto, ni aunque se fuerce con SQL.
      await expect(
        c.dueno.query(
          "insert into precio_de_venta (empresa_id, producto_id, precio, unidad_id, paso_minimo, vigente_desde) values ($1, $2, 1, 'UNIDAD', 1, now() + interval '1 day')",
          [e.empresa, id],
        ),
      ).rejects.toMatchObject({ code: "23514", constraint: "precio_propio_con_variante" });
    }
  });

  it("C5: dos personas editan las opciones del mismo producto con la misma versión: una gana, la otra OPCIONES_DESACTUALIZADA, y la versión sube UNA vez", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const id = await crear();
      const [a, b] = await aLaVez(
        [
          () =>
            firme(() =>
              c.casos.editarOpciones(e.gerente, {
                productoId: id,
                versionDeOpcionesEsperada: 0,
                grupos: [grupoAdicional("Salsas")],
              }),
            ),
          () =>
            firme(() =>
              c.casos.editarOpciones(e.gerente, {
                productoId: id,
                versionDeOpcionesEsperada: 0,
                grupos: [grupoAdicional("Aderezos")],
              }),
            ),
        ],
        ronda,
      );
      expect(
        [a, b].filter((r) => r.ok),
        `ronda ${ronda}`,
      ).toHaveLength(1);
      expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, error: "OPCIONES_DESACTUALIZADAS" });
      expect(await versionDeOpciones(id)).toBe(1);
      expect(
        await c.contar(
          "select count(*) as n from grupo_de_elecciones where producto_id = $1 and activo",
          [id],
        ),
      ).toBe(1);
    }
  });

  it("C6: dos crean «Medialuna» a la vez (o «medialuna» y «Medialuna»): uno solo existe y el otro PRODUCTO_DUPLICADO", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const nombre = nombreAlAzarDeProducto("Medialuna");
      const pedido = (n: string) => () =>
        firme(() =>
          c.casos.crearProducto(e.gerente, {
            id: nuevoId(),
            claseDeUso: "VENDIBLE",
            nombre: n,
            unidadBaseId: "UNIDAD",
            alicuota: "21",
          }),
        );
      const [a, b] = await aLaVez([pedido(nombre), pedido(nombre.toUpperCase())], ronda);
      expect([a.ok, b.ok].filter(Boolean), `ronda ${ronda}`).toHaveLength(1);
      expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, error: "PRODUCTO_DUPLICADO" });
      expect(
        await c.contar(
          "select count(*) as n from producto where empresa_id = $1 and nombre_clave = $2",
          [e.empresa, nombre.toLowerCase()],
        ),
      ).toBe(1);
    }
  });

  it("C7: un pedido que arrancó antes pero esperó el bloqueo no queda «detrás» de otro ya confirmado: el último en confirmarse es el vigente", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const id = await crear();
      const inicial = await precio(id, "100");
      // El segundo pedido trae un `ahora` MÁS VIEJO que el primero.
      const nuevo = CONTEXTO_CON_AHORA(e.gerente, "2026-10-12T10:00:00Z");
      const viejo = CONTEXTO_CON_AHORA(e.gerente, "2026-10-12T09:00:00Z");
      const primero = valorDe(
        await c.casos.cambiarPrecio(nuevo, {
          precioId: nuevoId(),
          productoId: id,
          opcionId: null,
          sucursalId: null,
          precioIdEsperado: inicial,
          precio: "200",
        }),
      );
      const segundo = valorDe(
        await c.casos.cambiarPrecio(viejo, {
          precioId: nuevoId(),
          productoId: id,
          opcionId: null,
          sucursalId: null,
          precioIdEsperado: primero.precioId,
          precio: "300",
        }),
      );
      expect(
        segundo.vigenteDesde &&
          primero.vigenteDesde &&
          segundo.vigenteDesde.getTime() >= primero.vigenteDesde.getTime(),
        `ronda ${ronda}`,
      ).toBe(true);
      const filas = await c.filas(
        "select precio::text as p, vigente_desde from precio_de_venta where producto_id = $1 order by vigente_desde desc, id desc",
        [id],
      );
      expect(filas[0]?.["p"]).toBe("300.000000");
      expect(
        await cotizarEnTx(c, e.gerente, {
          sucursalId: e.sucursal,
          productoId: id,
          ahora: new Date("2026-10-13T00:00:00Z"),
        }),
      ).toMatchObject({ ok: true, valor: { precioUnitario: "300.000000" } });
    }
  });

  it("C8: se copian opciones mientras alguien edita el destino: uno gana, el otro OPCIONES_DESACTUALIZADAS, y nunca queda un grupo repetido", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const origen = await crear();
      const destino = await crear();
      valorDe(
        await c.casos.editarOpciones(e.gerente, {
          productoId: origen,
          versionDeOpcionesEsperada: 0,
          grupos: [grupoAdicional("Extras")],
        }),
      );
      const [copia, edicion] = await aLaVez(
        [
          () =>
            firme(() =>
              c.casos.copiarOpciones(e.gerente, {
                copiaId: nuevoId(),
                productoOrigenId: origen,
                productoDestinoId: destino,
                versionDeOpcionesEsperada: 0,
              }),
            ),
          () =>
            firme(() =>
              c.casos.editarOpciones(e.gerente, {
                productoId: destino,
                versionDeOpcionesEsperada: 0,
                grupos: [grupoAdicional("Extras")],
              }),
            ),
        ],
        ronda,
      );
      expect([copia.ok, edicion.ok].filter(Boolean), `ronda ${ronda}`).toHaveLength(1);
      expect([copia, edicion].find((r) => !r.ok)).toEqual({
        ok: false,
        error: "OPCIONES_DESACTUALIZADAS",
      });
      expect(
        await c.contar("select count(*) as n from grupo_de_elecciones where producto_id = $1", [
          destino,
        ]),
      ).toBe(1);
      expect(await versionDeOpciones(destino)).toBe(1);
    }
  });

  it("I1/I2/I4 a la vez: el mismo precioId, el mismo id de producto, el mismo id de sección y el mismo copiaId lanzados dos veces simultáneas dejan UNA fila y devuelven yaExistia", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const id = await crear();
      const precioId = nuevoId();
      const pedidoDePrecio = () =>
        firme(() =>
          c.casos.cambiarPrecio(e.gerente, {
            precioId,
            productoId: id,
            opcionId: null,
            sucursalId: null,
            precioIdEsperado: null,
            precio: "77",
          }),
        );
      const [p1, p2] = await aLaVez([pedidoDePrecio, pedidoDePrecio], ronda);
      expect(
        [p1, p2].every((r) => r.ok),
        `precio ronda ${ronda}`,
      ).toBe(true);
      expect([p1, p2].filter((r) => r.ok && r.valor.yaExistia)).toHaveLength(1);
      expect(await contarPrecios(id)).toBe(1);

      const nuevo = nuevoId();
      const nombre = nombreAlAzarDeProducto();
      const pedidoDeProducto = () =>
        firme(() =>
          c.casos.crearProducto(e.gerente, {
            id: nuevo,
            claseDeUso: "VENDIBLE",
            nombre,
            unidadBaseId: "UNIDAD",
            alicuota: "21",
          }),
        );
      const [q1, q2] = await aLaVez([pedidoDeProducto, pedidoDeProducto], ronda);
      expect(
        [q1, q2].every((r) => r.ok),
        `producto ronda ${ronda}: ${JSON.stringify([q1, q2])}`,
      ).toBe(true);
      expect([q1, q2].filter((r) => r.ok && r.valor.yaExistia)).toHaveLength(1);
      expect(await c.contar("select count(*) as n from producto where id = $1", [nuevo])).toBe(1);

      const seccionId = nuevoId();
      const seccionNombre = nombreAlAzarDeProducto("Entradas");
      const pedidoDeSeccion = () =>
        firme(() =>
          c.casos.crearSeccionDeCarta(e.gerente, {
            id: seccionId,
            nombre: seccionNombre,
            orden: 1,
          }),
        );
      const [s1, s2] = await aLaVez([pedidoDeSeccion, pedidoDeSeccion], ronda);
      expect(
        [s1, s2].every((r) => r.ok),
        `sección ronda ${ronda}: ${JSON.stringify([s1, s2])}`,
      ).toBe(true);
      expect([s1, s2].filter((r) => r.ok && r.valor.yaExistia)).toHaveLength(1);
      expect(
        await c.contar("select count(*) as n from seccion_de_carta where id = $1", [seccionId]),
      ).toBe(1);

      const origen = await crear();
      const destino = await crear();
      valorDe(
        await c.casos.editarOpciones(e.gerente, {
          productoId: origen,
          versionDeOpcionesEsperada: 0,
          grupos: [grupoAdicional("Extras")],
        }),
      );
      const copiaId = nuevoId();
      const copiar = () =>
        firme(() =>
          c.casos.copiarOpciones(e.gerente, {
            copiaId,
            productoOrigenId: origen,
            productoDestinoId: destino,
            versionDeOpcionesEsperada: 0,
          }),
        );
      const [k1, k2] = await aLaVez([copiar, copiar], ronda);
      expect(
        [k1, k2].every((r) => r.ok),
        `copia ronda ${ronda}: ${JSON.stringify([k1, k2])}`,
      ).toBe(true);
      expect([k1, k2].filter((r) => r.ok && r.valor.yaExistia)).toHaveLength(1);
      expect(
        await c.contar("select count(*) as n from grupo_de_elecciones where producto_id = $1", [
          destino,
        ]),
      ).toBe(1);
    }
  });

  it("dos cambiarFormaDeVenta a la vez, o una contra un cambiarPrecio: uno gana y el otro ve VERSION_DESACTUALIZADA / PRECIO_DESACTUALIZADO; nunca precios en otra unidad que la del producto", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const id = await crear({ unidadBaseId: "GRAMO", unidadDeVentaId: "KILOGRAMO" });
      const inicial = await precio(id, "3000");
      const v = Number(
        (await c.filas("select version from producto where id = $1", [id]))[0]?.["version"],
      );
      const forma = (paso: string) => () =>
        firme(() =>
          c.casos.cambiarFormaDeVenta(e.gerente, {
            productoId: id,
            versionEsperada: v,
            unidadDeVentaId: "GRAMO",
            pasoMinimo: paso,
          }),
        );
      const [a, b] = await aLaVez([forma("1"), forma("5")], ronda);
      expect([a.ok, b.ok].filter(Boolean), `ronda ${ronda}`).toHaveLength(1);
      expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      // Contra un cambio de precio.
      const otro = await crear({ unidadBaseId: "GRAMO", unidadDeVentaId: "KILOGRAMO" });
      const base1 = await precio(otro, "3000");
      const v2 = Number(
        (await c.filas("select version from producto where id = $1", [otro]))[0]?.["version"],
      );
      const [f, p] = await aLaVez(
        [
          () =>
            firme(() =>
              c.casos.cambiarFormaDeVenta(e.gerente, {
                productoId: otro,
                versionEsperada: v2,
                unidadDeVentaId: "GRAMO",
                pasoMinimo: "1",
              }),
            ),
          () =>
            firme(() =>
              c.casos.cambiarPrecio(e.gerente, {
                precioId: nuevoId(),
                productoId: otro,
                opcionId: null,
                sucursalId: null,
                precioIdEsperado: base1,
                precio: "3300",
              }),
            ),
        ],
        ronda,
      );
      expect(f.ok, `forma ronda ${ronda}: ${JSON.stringify(f)}`).toBe(true);
      // El precio, o entró antes (y se convirtió con el producto) o se rechazó por ver el producto ya cambiado: nunca queda en otra unidad.
      if (!p.ok) expect(p).toMatchObject({ ok: false, error: { error: "PRECIO_DESACTUALIZADO" } });
      const vigenteDeFila = await c.filas(
        "select p.unidad_id, p.paso_minimo::text as paso, pr.unidad_de_venta_id, pr.paso_minimo::text as pr_paso from precio_de_venta p join producto pr on pr.id = p.producto_id where p.producto_id = $1 order by p.vigente_desde desc, p.id desc limit 1",
        [otro],
      );
      expect(vigenteDeFila[0]).toMatchObject({ unidad_id: "GRAMO", unidad_de_venta_id: "GRAMO" });
      expect(inicial).toBeTruthy();
    }
  });
});

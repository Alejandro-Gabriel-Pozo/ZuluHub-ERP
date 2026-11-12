import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  montarCatalogo,
  precioDeBase,
  productoDeBase,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * T2 de la carta real contra una base real, por los casos de uso de verdad (guard, perilla, transacción, auditoría): la carta pública, reordenar y reactivar
 * secciones, el botón «Ocultar», `desactivarProducto` alineado y las consultas. Los valores son los de §8.2 de la especificación.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("carta pública y «Ocultar»: casos de uso", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  beforeAll(async () => {
    if (base !== null) c = await montarCatalogo(base);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Una empresa con la carta del ensayo: secciones Entradas/Platos/Postres/Cafetería y productos con precio (de §8.1, los que salen). */
  const ensayo = async () => {
    const e = await c.escenario();
    const seccion = async (nombre: string, orden: number, activa = true) => {
      const id = randomUUID();
      await c.dueno.query(
        "insert into seccion_de_carta (id, empresa_id, nombre, nombre_clave, orden, activa) values ($1, $2, $3, $4, $5, $6)",
        [id, e.empresa, nombre, nombre.toLowerCase(), orden, activa],
      );
      return id;
    };
    const producto = async (
      nombre: string,
      precio: string | null,
      seccionId: string | null,
      activo = true,
    ) => {
      const id = await productoDeBase(c.dueno, e.empresa, { nombre, activo });
      if (seccionId !== null)
        await c.dueno.query("update producto set seccion_de_carta_id = $2 where id = $1", [
          id,
          seccionId,
        ]);
      if (precio !== null)
        await precioDeBase(c.dueno, {
          empresa: e.empresa,
          producto: id,
          precio,
          desde: "2026-10-01T00:00:00Z",
        });
      return id;
    };
    const entradas = await seccion("Entradas", 0);
    const platos = await seccion("Platos", 1);
    const postres = await seccion("Postres", 2);
    const cafeteria = await seccion("Cafetería", 3);
    const empanada = await producto("Empanada de carne", "1500", entradas);
    const milanesa = await producto("Milanesa napolitana", "9500", platos);
    const flan = await producto("Flan", "4200.50", postres);
    const cafe = await producto("Café", "2000", cafeteria);
    const helado = await producto("Helado", null, postres);
    const tarta = await producto("Tarta de ricota", "3800", postres, false);
    const sopa = await producto("Sopa del día", "3000", null);
    return {
      e,
      secciones: { entradas, platos, postres, cafeteria },
      p: { empanada, milanesa, flan, cafe, helado, tarta, sopa },
    };
  };
  const cartaNueva = (e: EscenarioDeCatalogo, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    sucursalId: e.sucursal,
    nombre: "Parador El Ensayo",
    estado: "FUERA_DE_LINEA" as const,
    ...extra,
  });
  const auditorias = async (e: EscenarioDeCatalogo, accion: string) =>
    (await c.auditoria(e.empresa, accion)).length;
  const filasDeDisponibilidad = (e: EscenarioDeCatalogo) =>
    c.contar("select count(*) as n from disponibilidad_de_producto where empresa_id = $1", [
      e.empresa,
    ]);

  describe("guardarCartaPublica", () => {
    it("C-1: guardarCartaPublica con el mismo id dos veces deja UNA carta, un solo código y una entrada de auditoría; la segunda es yaExistia", async () => {
      const { e } = await ensayo();
      const pedido = cartaNueva(e, {
        rubro: "Parrilla",
        lugar: "Huinganco",
        mensajeDePortada: "Desliza para ver el menú",
      });
      const primera = valorDe(await c.casos.guardarCartaPublica(e.gerente, pedido));
      expect(primera).toMatchObject({
        cartaId: pedido.id,
        estado: "FUERA_DE_LINEA",
        version: 1,
        yaExistia: false,
      });
      expect(primera.codigo).toMatch(/^[A-Za-z0-9_-]{22}$/);
      const segunda = valorDe(await c.casos.guardarCartaPublica(e.gerente, pedido));
      expect(segunda).toEqual({ ...primera, yaExistia: true });
      expect(
        await c.contar("select count(*) as n from carta_publica where empresa_id = $1", [
          e.empresa,
        ]),
      ).toBe(1);
      expect(await auditorias(e, "CARTA_PUBLICA_CREADA")).toBe(1);
      // Con otro contenido, el id se reutilizó; con otra sucursal, también.
      expect(
        await c.casos.guardarCartaPublica(e.gerente, {
          ...pedido,
          versionEsperada: 1,
          nombre: "Otro",
        }),
      ).toMatchObject({ ok: true });
      expect(
        await c.casos.guardarCartaPublica(e.gerente, { ...pedido, sucursalId: e.otraSucursal }),
      ).toEqual({ ok: false, error: "ID_REUTILIZADO" });
    });

    it("el vacío de rubro, lugar y mensaje se guarda como NULL, y el nombre es libre y propio de la sucursal", async () => {
      const { e } = await ensayo();
      const pedido = cartaNueva(e, {
        nombre: "¿Querés papas? 50% $",
        rubro: "  ",
        lugar: "",
        mensajeDePortada: null,
      });
      valorDe(await c.casos.guardarCartaPublica(e.gerente, pedido));
      const { rows } = await c.dueno.query<{
        nombre: string;
        rubro: string | null;
        lugar: string | null;
        mensaje_de_portada: string | null;
      }>("select nombre, rubro, lugar, mensaje_de_portada from carta_publica where id = $1", [
        pedido.id,
      ]);
      expect(rows[0]).toEqual({
        nombre: "¿Querés papas? 50% $",
        rubro: null,
        lugar: null,
        mensaje_de_portada: null,
      });
    });

    it("V-1 y V-3: nombre de 81 caracteres, vacío, con salto de línea o con `<` es NOMBRE_DE_CARTA_INVALIDO; rubro, lugar y mensaje con su error; sucursal inactiva, SUCURSAL_INACTIVA", async () => {
      const { e } = await ensayo();
      for (const nombre of ["a".repeat(81), "", "a\nb", "<b>"]) {
        expect(
          await c.casos.guardarCartaPublica(e.gerente, cartaNueva(e, { nombre })),
          JSON.stringify(nombre),
        ).toEqual({ ok: false, error: "NOMBRE_DE_CARTA_INVALIDO" });
      }
      expect(
        await c.casos.guardarCartaPublica(e.gerente, cartaNueva(e, { rubro: "a".repeat(41) })),
      ).toEqual({ ok: false, error: "RUBRO_DE_CARTA_INVALIDO" });
      expect(
        await c.casos.guardarCartaPublica(e.gerente, cartaNueva(e, { lugar: "a".repeat(121) })),
      ).toEqual({ ok: false, error: "LUGAR_DE_CARTA_INVALIDO" });
      expect(
        await c.casos.guardarCartaPublica(
          e.gerente,
          cartaNueva(e, { mensajeDePortada: "a".repeat(61) }),
        ),
      ).toEqual({ ok: false, error: "MENSAJE_DE_PORTADA_INVALIDO" });
      expect(
        await c.casos.guardarCartaPublica(
          e.gerente,
          cartaNueva(e, { mensajeDePortada: "a".repeat(60) }),
        ),
      ).toMatchObject({ ok: true });
      expect(
        await c.casos.guardarCartaPublica(e.gerente, cartaNueva(e, { estado: "BORRADOR" })),
      ).toEqual({ ok: false, error: "ESTADO_DE_CARTA_INVALIDO" });
      expect(
        await c.casos.guardarCartaPublica(e.gerente, { ...cartaNueva(e), id: "no-es-uuid" }),
      ).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
      await c.dueno.query("update sucursal set activa = false where id = $1", [e.otraSucursal]);
      expect(
        await c.casos.guardarCartaPublica(e.gerente, cartaNueva(e, { sucursalId: e.otraSucursal })),
      ).toEqual({ ok: false, error: "SUCURSAL_INACTIVA" });
    });

    it("V-4 y R-3: poner EN_LINEA exige un producto que salga y la perilla; retirar de línea funciona aun con la perilla apagada", async () => {
      const { e } = await ensayo();
      const vacia = await c.escenario();
      expect(
        await c.casos.guardarCartaPublica(vacia.gerente, cartaNueva(vacia, { estado: "EN_LINEA" })),
      ).toEqual({ ok: false, error: "CARTA_SIN_PRODUCTOS_VISIBLES" });
      expect(
        await c.contar("select count(*) as n from carta_publica where empresa_id = $1", [
          vacia.empresa,
        ]),
      ).toBe(0);
      const pedido = cartaNueva(e, { estado: "EN_LINEA" });
      const creada = valorDe(await c.casos.guardarCartaPublica(e.gerente, pedido));
      expect(creada.estado).toBe("EN_LINEA");
      c.perillaDeCarta(false);
      try {
        const retirada = await c.casos.guardarCartaPublica(e.gerente, {
          ...pedido,
          estado: "FUERA_DE_LINEA",
          versionEsperada: creada.version,
        });
        expect(valorDe(retirada)).toMatchObject({ estado: "FUERA_DE_LINEA", version: 2 });
        expect(
          await c.casos.guardarCartaPublica(e.gerente, { ...pedido, versionEsperada: 2 }),
        ).toEqual({
          ok: false,
          error: { codigo: "FUNCION_NO_INCLUIDA", perilla: "vidriera_por_qr" },
        });
        expect(
          await c.casos.guardarCartaPublica(
            vacia.gerente,
            cartaNueva(vacia, { estado: "EN_LINEA" }),
          ),
        ).toMatchObject({ ok: false });
      } finally {
        c.perillaDeCarta(true);
      }
      expect(await auditorias(e, "CARTA_PUBLICA_RETIRADA")).toBe(1);
    });

    it("editar exige la versión (VERSION_DESACTUALIZADA), una carta por sucursal, y deja antes y después en la auditoría", async () => {
      const { e } = await ensayo();
      const pedido = cartaNueva(e);
      const creada = valorDe(await c.casos.guardarCartaPublica(e.gerente, pedido));
      expect(await c.casos.guardarCartaPublica(e.gerente, { ...pedido, nombre: "Otro" })).toEqual({
        ok: false,
        error: "VERSION_DESACTUALIZADA",
      });
      expect(
        await c.casos.guardarCartaPublica(e.gerente, {
          ...pedido,
          nombre: "Otro",
          versionEsperada: 7,
        }),
      ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      const editada = valorDe(
        await c.casos.guardarCartaPublica(e.gerente, {
          ...pedido,
          nombre: "Otro",
          versionEsperada: creada.version,
        }),
      );
      expect(editada).toMatchObject({ version: 2, codigo: creada.codigo, yaExistia: false });
      expect(await c.casos.guardarCartaPublica(e.gerente, cartaNueva(e))).toEqual({
        ok: false,
        error: "CARTA_DE_LA_SUCURSAL_YA_EXISTE",
      });
      const [entrada] = await c.auditoria(e.empresa, "CARTA_PUBLICA_EDITADA");
      expect(entrada).toMatchObject({ entidad: "carta_publica", entidad_id: pedido.id });
      expect(entrada?.antes).toMatchObject({ nombre: "Parador El Ensayo" });
      expect(entrada?.despues).toMatchObject({ nombre: "Otro" });
    });

    it("R-1, R-2 y R-4: el operador y un administrador de una sola sucursal no pueden; una empresa no toca la carta de otra", async () => {
      const { e } = await ensayo();
      expect(await c.casos.guardarCartaPublica(e.operador, cartaNueva(e))).toMatchObject({
        ok: false,
      });
      expect(
        await c.casos.guardarCartaPublica(e.administradorDeUnaSucursal, cartaNueva(e)),
      ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      const otra = await c.escenario();
      const pedido = cartaNueva(e);
      valorDe(await c.casos.guardarCartaPublica(e.administrador, pedido));
      // Otra empresa con el id de la carta de esta: ni la ve ni la edita (la sucursal es la suya, el id está ocupado por otra empresa).
      const ajeno = await c.casos.guardarCartaPublica(otra.gerente, {
        ...pedido,
        sucursalId: otra.sucursal,
      });
      expect(ajeno).toMatchObject({ ok: false });
      expect(
        await c.contar("select count(*) as n from carta_publica where empresa_id = $1", [
          otra.empresa,
        ]),
      ).toBe(0);
    });
  });

  describe("secciones: reordenar y reactivar", () => {
    const versiones = async (e: EscenarioDeCatalogo) =>
      await c.filas<{ id: string; orden: number; version: number }>(
        "select id, orden, version from seccion_de_carta where empresa_id = $1 and activa order by orden, id",
        [e.empresa],
      );
    const lista = (filas: readonly { id: string; version: number }[], ids: readonly string[]) =>
      ids.map((id) => ({
        seccionId: id,
        versionEsperada: filas.find((f) => f.id === id)?.version as number,
      }));

    it("C-3 y C-6: reordenar asigna orden = posición en una sola transacción; con la versión vieja de UNA, no cambia ninguna", async () => {
      const { e, secciones: s } = await ensayo();
      const filas = await versiones(e);
      const nuevo = [s.cafeteria, s.platos, s.entradas, s.postres];
      const viejas = lista(filas, nuevo);
      const [primera, ...resto] = viejas;
      expect(
        await c.casos.reordenarSeccionesDeCarta(e.gerente, {
          secciones: [{ ...(primera as object), versionEsperada: 99 } as never, ...resto],
        }),
      ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      expect((await versiones(e)).map((f) => f.orden)).toEqual([0, 1, 2, 3]);
      expect(
        valorDe(await c.casos.reordenarSeccionesDeCarta(e.gerente, { secciones: viejas })),
      ).toEqual({ movidas: 3 });
      const despues = await versiones(e);
      expect(despues.map((f) => f.id)).toEqual(nuevo);
      expect(despues.map((f) => f.orden)).toEqual([0, 1, 2, 3]);
      expect(await auditorias(e, "SECCIONES_DE_CARTA_REORDENADAS")).toBe(1);
    });

    it("C-4: repetir el reordenamiento ya aplicado es SIN_CAMBIOS: no sube ninguna versión ni audita, aunque las versiones sean viejas", async () => {
      const { e, secciones: s } = await ensayo();
      const filas = await versiones(e);
      const pedido = lista(filas, [s.cafeteria, s.platos, s.entradas, s.postres]);
      valorDe(await c.casos.reordenarSeccionesDeCarta(e.gerente, { secciones: pedido }));
      const antes = await versiones(e);
      expect(
        valorDe(await c.casos.reordenarSeccionesDeCarta(e.gerente, { secciones: pedido })),
      ).toEqual({ movidas: 0 });
      expect(await versiones(e)).toEqual(antes);
      expect(await auditorias(e, "SECCIONES_DE_CARTA_REORDENADAS")).toBe(1);
      // El orden que ya es el vigente, con las versiones de hoy: también sin cambios.
      expect(
        valorDe(
          await c.casos.reordenarSeccionesDeCarta(e.gerente, {
            secciones: lista(
              antes,
              antes.map((f) => f.id),
            ),
          }),
        ),
      ).toEqual({ movidas: 0 });
    });

    it("C-5 y C-7: lista incompleta, sección repetida, de otra empresa o inexistente; nada cambia", async () => {
      const { e, secciones: s } = await ensayo();
      const filas = await versiones(e);
      const otra = await ensayo();
      const sinCambios = async () =>
        expect((await versiones(e)).map((f) => f.orden)).toEqual([0, 1, 2, 3]);
      expect(
        await c.casos.reordenarSeccionesDeCarta(e.gerente, {
          secciones: lista(filas, [s.cafeteria, s.platos, s.entradas]),
        }),
      ).toEqual({ ok: false, error: "LISTA_DE_SECCIONES_INCOMPLETA" });
      expect(
        await c.casos.reordenarSeccionesDeCarta(e.gerente, {
          secciones: lista(filas, [s.cafeteria, s.platos, s.entradas, s.entradas]),
        }),
      ).toEqual({ ok: false, error: "SECCION_REPETIDA" });
      expect(
        await c.casos.reordenarSeccionesDeCarta(e.gerente, {
          secciones: [
            ...lista(filas, [s.cafeteria, s.platos, s.entradas]),
            { seccionId: otra.secciones.postres, versionEsperada: 1 },
          ],
        }),
      ).toEqual({ ok: false, error: "SECCION_NO_ENCONTRADA" });
      expect(
        await c.casos.reordenarSeccionesDeCarta(otra.e.gerente, {
          secciones: lista(filas, [s.cafeteria, s.platos, s.entradas, s.postres]),
        }),
      ).toEqual({ ok: false, error: "SECCION_NO_ENCONTRADA" });
      expect(
        await c.casos.reordenarSeccionesDeCarta(e.gerente, {
          secciones: [{ seccionId: "no-es-uuid", versionEsperada: 1 }],
        }),
      ).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
      expect(
        await c.casos.reordenarSeccionesDeCarta(e.gerente, {
          secciones: Array.from({ length: 201 }, () => ({
            seccionId: randomUUID(),
            versionEsperada: 1,
          })),
        }),
      ).toEqual({ ok: false, error: "ORDEN_INVALIDO" });
      await sinCambios();
      // C-7: otra persona crea «Bebidas» mientras se arrastraba.
      await c.dueno.query(
        "insert into seccion_de_carta (empresa_id, nombre, nombre_clave, orden) values ($1, 'Bebidas', 'bebidas', 4)",
        [e.empresa],
      );
      expect(
        await c.casos.reordenarSeccionesDeCarta(e.gerente, {
          secciones: lista(filas, [s.cafeteria, s.platos, s.entradas, s.postres]),
        }),
      ).toEqual({ ok: false, error: "LISTA_DE_SECCIONES_INCOMPLETA" });
      expect((await versiones(e)).slice(0, 4).map((f) => f.orden)).toEqual([0, 1, 2, 3]);
      expect(await c.casos.reordenarSeccionesDeCarta(e.operador, { secciones: [] })).toMatchObject({
        ok: false,
      });
    });

    it("L-7: desactivar y reactivar una sección devuelve sus productos a la carta sin editar ninguno; repetir cada una es yaEstaba", async () => {
      const { e, secciones: s } = await ensayo();
      const pedido = cartaNueva(e, { estado: "EN_LINEA" });
      valorDe(await c.casos.guardarCartaPublica(e.gerente, pedido));
      const salen = async () =>
        valorDe(await c.consultas.verCartaPublica(e.gerente, { sucursalId: e.sucursal }))
          .visibilidad.salen;
      expect(await salen()).toBe(4);
      expect(
        valorDe(await c.casos.desactivarSeccionDeCarta(e.gerente, { seccionId: s.postres })),
      ).toEqual({ yaEstaba: false });
      expect(await salen()).toBe(3);
      expect(
        valorDe(await c.casos.desactivarSeccionDeCarta(e.gerente, { seccionId: s.postres })),
      ).toEqual({ yaEstaba: true });
      const productosAntes = await c.contar(
        "select sum(version) as n from producto where empresa_id = $1",
        [e.empresa],
      );
      expect(
        valorDe(await c.casos.reactivarSeccionDeCarta(e.gerente, { seccionId: s.postres })),
      ).toEqual({ yaEstaba: false });
      expect(
        valorDe(await c.casos.reactivarSeccionDeCarta(e.gerente, { seccionId: s.postres })),
      ).toEqual({ yaEstaba: true });
      expect(
        await c.contar("select sum(version) as n from producto where empresa_id = $1", [e.empresa]),
      ).toBe(productosAntes);
      expect(await salen()).toBe(4);
      expect(await auditorias(e, "SECCION_DE_CARTA_REACTIVADA")).toBe(1);
      expect(await c.casos.reactivarSeccionDeCarta(e.gerente, { seccionId: randomUUID() })).toEqual(
        { ok: false, error: "SECCION_NO_ENCONTRADA" },
      );
      expect(
        await c.casos.reactivarSeccionDeCarta(e.operador, { seccionId: s.postres }),
      ).toMatchObject({ ok: false });
    });
  });

  describe("botón «Ocultar»", () => {
    const ocultar = (
      ctx: EscenarioDeCatalogo["gerente"],
      producto: string,
      alcance: { tipo: "EMPRESA" } | { tipo: "SUCURSAL"; sucursalId: string },
      oculto = true,
    ) => c.casos.ocultarProducto(ctx, { productoId: producto, alcance, oculto });

    it("D-1: ocultar en un local saca el producto de la carta de ESE local y de ningún otro", async () => {
      const { e, p } = await ensayo();
      const salen = async (sucursalId: string) =>
        valorDe(await c.consultas.verCartaPublica(e.gerente, { sucursalId })).visibilidad;
      expect((await salen(e.sucursal)).salen).toBe(4);
      expect(
        valorDe(await ocultar(e.gerente, p.flan, { tipo: "SUCURSAL", sucursalId: e.sucursal })),
      ).toEqual({ yaEstaba: false, sigueOcultoPor: null });
      expect(await salen(e.sucursal)).toMatchObject({ salen: 3, faltan: { ocultos: 1 } });
      expect((await salen(e.otraSucursal)).salen).toBe(4);
    });

    it("D-2: ocultar en TODA la empresa afecta a todos los locales; mostrar en el local no deshace lo de la empresa", async () => {
      const { e, p } = await ensayo();
      const local = { tipo: "SUCURSAL", sucursalId: e.sucursal } as const;
      const salen = async (sucursalId: string) =>
        valorDe(await c.consultas.verCartaPublica(e.gerente, { sucursalId })).visibilidad.salen;
      valorDe(await ocultar(e.gerente, p.flan, { tipo: "EMPRESA" }));
      expect([await salen(e.sucursal), await salen(e.otraSucursal)]).toEqual([3, 3]);
      valorDe(await ocultar(e.gerente, p.flan, local));
      expect(valorDe(await ocultar(e.gerente, p.flan, local, false))).toEqual({
        yaEstaba: false,
        sigueOcultoPor: "EMPRESA",
      });
      expect(await salen(e.sucursal)).toBe(3);
      valorDe(await ocultar(e.gerente, p.flan, { tipo: "EMPRESA" }, false));
      expect([await salen(e.sucursal), await salen(e.otraSucursal)]).toEqual([4, 4]);
    });

    it("D-3 y D-13: oculto y desactivado son independientes; reactivar no muestra, mostrar no reactiva; oculto no fuerza a salir", async () => {
      const { e, p } = await ensayo();
      const local = { tipo: "SUCURSAL", sucursalId: e.sucursal } as const;
      valorDe(await ocultar(e.gerente, p.tarta, local));
      expect(valorDe(await c.casos.reactivarProducto(e.gerente, { productoId: p.tarta }))).toEqual({
        yaEstaba: false,
      });
      const vis = async () =>
        valorDe(await c.consultas.verCartaPublica(e.gerente, { sucursalId: e.sucursal }))
          .visibilidad;
      expect(await vis()).toMatchObject({ salen: 4, faltan: { ocultos: 1 } });
      valorDe(await ocultar(e.gerente, p.tarta, local, false));
      expect((await vis()).salen).toBe(5);
      expect(valorDe(await c.casos.desactivarProducto(e.gerente, { productoId: p.tarta }))).toEqual(
        { yaEstaba: false },
      );
      valorDe(await ocultar(e.gerente, p.tarta, local));
      valorDe(await ocultar(e.gerente, p.tarta, local, false));
      expect(
        await c.contar("select count(*) as n from producto where id = $1 and not activo", [
          p.tarta,
        ]),
      ).toBe(1);
      // Un producto oculto, sin precio y en sección apagada sigue sin salir al mostrarlo.
      valorDe(await ocultar(e.gerente, p.helado, local));
      valorDe(await ocultar(e.gerente, p.helado, local, false));
      expect((await vis()).faltan.sinPrecio).toBe(1);
    });

    it("D-4: ocultar dos veces deja una fila y la segunda es yaEstaba sin auditar; true, false, false deja el producto visible", async () => {
      const { e, p } = await ensayo();
      const local = { tipo: "SUCURSAL", sucursalId: e.sucursal } as const;
      expect(valorDe(await ocultar(e.gerente, p.flan, local))).toMatchObject({ yaEstaba: false });
      expect(valorDe(await ocultar(e.gerente, p.flan, local))).toMatchObject({ yaEstaba: true });
      expect(await filasDeDisponibilidad(e)).toBe(1);
      expect(await auditorias(e, "PRODUCTO_OCULTADO")).toBe(1);
      expect(valorDe(await ocultar(e.gerente, p.flan, local, false))).toMatchObject({
        yaEstaba: false,
      });
      expect(valorDe(await ocultar(e.gerente, p.flan, local, false))).toMatchObject({
        yaEstaba: true,
      });
      expect(await filasDeDisponibilidad(e)).toBe(1);
      expect(await auditorias(e, "PRODUCTO_MOSTRADO")).toBe(1);
      expect(
        await c.contar(
          "select count(*) as n from disponibilidad_de_producto where empresa_id = $1 and oculto",
          [e.empresa],
        ),
      ).toBe(0);
      // Un producto que nunca se tocó: «mostrar» ya estaba, y no deja fila.
      expect(valorDe(await ocultar(e.gerente, p.cafe, local, false))).toMatchObject({
        yaEstaba: true,
      });
      expect(await filasDeDisponibilidad(e)).toBe(1);
    });

    it("D-5 y D-6: con existencia (también negativa) o con un conteo abierto con cargas no se oculta, sin dejar fila ni auditoría; sin stock, siempre", async () => {
      const { e, p } = await ensayo();
      const local = { tipo: "SUCURSAL", sucursalId: e.sucursal } as const;
      c.stock.limpiar();
      c.stock.fijarExistencia(p.cafe, e.sucursal, 5);
      expect(await ocultar(e.gerente, p.cafe, local)).toEqual({
        ok: false,
        error: "PRODUCTO_CON_EXISTENCIA",
      });
      expect(await filasDeDisponibilidad(e)).toBe(0);
      expect(await auditorias(e, "PRODUCTO_OCULTADO")).toBe(0);
      c.stock.fijarExistencia(p.cafe, e.sucursal, -1);
      expect(await ocultar(e.gerente, p.cafe, local)).toEqual({
        ok: false,
        error: "PRODUCTO_CON_EXISTENCIA",
      });
      c.stock.fijarExistencia(p.cafe, e.sucursal, 0);
      c.stock.fijarExistencia(p.cafe, e.otraSucursal, 2);
      expect(valorDe(await ocultar(e.gerente, p.cafe, local))).toMatchObject({ yaEstaba: false });
      expect(await ocultar(e.gerente, p.cafe, { tipo: "EMPRESA" })).toEqual({
        ok: false,
        error: "PRODUCTO_CON_EXISTENCIA",
      });
      expect(await filasDeDisponibilidad(e)).toBe(1);
      c.stock.limpiar();
      c.stock.abrirConteoConCargas(p.milanesa, e.sucursal);
      expect(await ocultar(e.gerente, p.milanesa, local)).toEqual({
        ok: false,
        error: "PRODUCTO_CON_CONTEO_ABIERTO",
      });
      c.stock.limpiar();
      expect(valorDe(await ocultar(e.gerente, p.milanesa, local))).toMatchObject({
        yaEstaba: false,
      });
      // Mostrar nunca depende del stock.
      c.stock.fijarExistencia(p.milanesa, e.sucursal, 9);
      expect(valorDe(await ocultar(e.gerente, p.milanesa, local, false))).toMatchObject({
        yaEstaba: false,
      });
      c.stock.limpiar();
    });

    it("D-9: el operador oculta en SU local, no en otro ni en toda la empresa; sin el permiso o de otra empresa, no", async () => {
      const { e, p } = await ensayo();
      expect(
        valorDe(await ocultar(e.operador, p.flan, { tipo: "SUCURSAL", sucursalId: e.sucursal })),
      ).toMatchObject({ yaEstaba: false });
      expect(
        await ocultar(e.operador, p.flan, { tipo: "SUCURSAL", sucursalId: e.otraSucursal }),
      ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      expect(await ocultar(e.operador, p.flan, { tipo: "EMPRESA" })).toMatchObject({ ok: false });
      expect(await ocultar(e.administradorDeUnaSucursal, p.flan, { tipo: "EMPRESA" })).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      expect(valorDe(await ocultar(e.administrador, p.flan, { tipo: "EMPRESA" }))).toMatchObject({
        yaEstaba: false,
      });
      // El operador muestra en su local, pero la empresa lo sigue ocultando.
      expect(
        valorDe(
          await ocultar(e.operador, p.flan, { tipo: "SUCURSAL", sucursalId: e.sucursal }, false),
        ),
      ).toEqual({ yaEstaba: false, sigueOcultoPor: "EMPRESA" });
      expect(await ocultar(e.operador, p.flan, { tipo: "EMPRESA" }, false)).toMatchObject({
        ok: false,
      });
    });

    it("D-10 y D-11: otra empresa no toca el producto (PRODUCTO_NO_ENCONTRADO); EMPRESA con existencia en un local no deja fila; la auditoría guarda alcance, antes y después", async () => {
      const { e, p } = await ensayo();
      const otra = await c.escenario();
      expect(await ocultar(otra.gerente, p.flan, { tipo: "EMPRESA" })).toEqual({
        ok: false,
        error: "PRODUCTO_NO_ENCONTRADO",
      });
      expect(await ocultar(e.gerente, randomUUID(), { tipo: "EMPRESA" })).toEqual({
        ok: false,
        error: "PRODUCTO_NO_ENCONTRADO",
      });
      expect(
        await ocultar(e.gerente, p.flan, { tipo: "SUCURSAL", sucursalId: otra.sucursal }),
      ).toMatchObject({ ok: false });
      c.stock.limpiar();
      c.stock.fijarExistencia(p.cafe, e.otraSucursal, 3);
      expect(await ocultar(e.gerente, p.cafe, { tipo: "EMPRESA" })).toEqual({
        ok: false,
        error: "PRODUCTO_CON_EXISTENCIA",
      });
      expect(await filasDeDisponibilidad(e)).toBe(0);
      c.stock.limpiar();
      valorDe(await ocultar(e.gerente, p.flan, { tipo: "SUCURSAL", sucursalId: e.sucursal }));
      const [entrada] = await c.auditoria(e.empresa, "PRODUCTO_OCULTADO");
      expect(entrada).toMatchObject({
        entidad: "producto",
        entidad_id: p.flan,
        actor_persona_id: e.personaDelGerente,
      });
      expect(entrada?.antes).toEqual({
        oculto: false,
        alcance: "SUCURSAL",
        sucursalId: e.sucursal,
      });
      expect(entrada?.despues).toEqual({
        oculto: true,
        alcance: "SUCURSAL",
        sucursalId: e.sucursal,
      });
    });

    it("D-14: desactivarProducto con existencia o con un conteo abierto con cargas se frena; con 0 se desactiva; reactivar no tiene condiciones", async () => {
      const { e, p } = await ensayo();
      c.stock.limpiar();
      c.stock.fijarExistencia(p.cafe, e.sucursal, 5);
      expect(await c.casos.desactivarProducto(e.gerente, { productoId: p.cafe })).toEqual({
        ok: false,
        error: "PRODUCTO_CON_EXISTENCIA",
      });
      c.stock.fijarExistencia(p.cafe, e.sucursal, 0);
      c.stock.abrirConteoConCargas(p.cafe, e.sucursal);
      expect(await c.casos.desactivarProducto(e.gerente, { productoId: p.cafe })).toEqual({
        ok: false,
        error: "PRODUCTO_CON_CONTEO_ABIERTO",
      });
      expect(
        await c.contar("select count(*) as n from producto where id = $1 and activo", [p.cafe]),
      ).toBe(1);
      c.stock.limpiar();
      expect(valorDe(await c.casos.desactivarProducto(e.gerente, { productoId: p.cafe }))).toEqual({
        yaEstaba: false,
      });
      c.stock.fijarExistencia(p.cafe, e.sucursal, 4);
      expect(valorDe(await c.casos.desactivarProducto(e.gerente, { productoId: p.cafe }))).toEqual({
        yaEstaba: true,
      });
      expect(valorDe(await c.casos.reactivarProducto(e.gerente, { productoId: p.cafe }))).toEqual({
        yaEstaba: false,
      });
      c.stock.limpiar();
    });
  });

  describe("consultas", () => {
    it("verCartaPublica: sin carta, con carta (ruta, textos, versión), cuántos salen y por qué faltan; sucursal ajena o inexistente", async () => {
      const { e } = await ensayo();
      const sin = valorDe(await c.consultas.verCartaPublica(e.gerente, { sucursalId: e.sucursal }));
      expect(sin.carta).toBeNull();
      expect(sin).toMatchObject({
        sucursalActiva: true,
        visibilidad: {
          salen: 4,
          faltan: { desactivados: 1, ocultos: 0, sinSeccion: 1, sinPrecio: 1 },
        },
      });
      const pedido = cartaNueva(e, { rubro: "Parrilla", mensajeDePortada: "¡Bienvenidos!" });
      const creada = valorDe(await c.casos.guardarCartaPublica(e.gerente, pedido));
      const vista = valorDe(
        await c.consultas.verCartaPublica(e.operador, { sucursalId: e.sucursal }),
      );
      expect(vista.carta).toEqual({
        id: pedido.id,
        codigo: creada.codigo,
        rutaPublica: `/s/carta/${creada.codigo}`,
        nombre: "Parador El Ensayo",
        rubro: "Parrilla",
        lugar: null,
        mensajeDePortada: "¡Bienvenidos!",
        estado: "FUERA_DE_LINEA",
        version: 1,
      });
      await c.dueno.query("update sucursal set activa = false where id = $1", [e.sucursal]);
      expect(
        valorDe(await c.consultas.verCartaPublica(e.gerente, { sucursalId: e.sucursal }))
          .sucursalActiva,
      ).toBe(false);
      expect(await c.consultas.verCartaPublica(e.operador, { sucursalId: e.otraSucursal })).toEqual(
        { ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" },
      );
      expect(await c.consultas.verCartaPublica(e.gerente, { sucursalId: randomUUID() })).toEqual({
        ok: false,
        error: "SUCURSAL_NO_ENCONTRADA",
      });
      expect(await c.consultas.verCartaPublica(e.gerente, { sucursalId: "x" })).toEqual({
        ok: false,
        error: "SUCURSAL_NO_ENCONTRADA",
      });
      const otra = await c.escenario();
      expect(await c.consultas.verCartaPublica(otra.gerente, { sucursalId: e.sucursal })).toEqual({
        ok: false,
        error: "SUCURSAL_NO_ENCONTRADA",
      });
    });

    it("productosOcultos: los de la empresa y los del local, con nombre, quién y cuándo; sin sucursal solo con alcance total; nunca los de otro local ni otra empresa", async () => {
      const { e, p } = await ensayo();
      const ocultar = (
        ctx: EscenarioDeCatalogo["gerente"],
        producto: string,
        alcance: { tipo: "EMPRESA" } | { tipo: "SUCURSAL"; sucursalId: string },
      ) => c.casos.ocultarProducto(ctx, { productoId: producto, alcance, oculto: true });
      valorDe(await ocultar(e.gerente, p.flan, { tipo: "EMPRESA" }));
      valorDe(await ocultar(e.gerente, p.cafe, { tipo: "SUCURSAL", sucursalId: e.sucursal }));
      valorDe(
        await ocultar(e.gerente, p.milanesa, { tipo: "SUCURSAL", sucursalId: e.otraSucursal }),
      );
      const delLocal = valorDe(
        await c.consultas.productosOcultos(e.operador, { sucursalId: e.sucursal }),
      );
      expect(delLocal.map((f) => [f.nombre, f.sucursalId])).toEqual([
        ["Café", e.sucursal],
        ["Flan", null],
      ]);
      expect(delLocal[0]).toMatchObject({
        productoId: p.cafe,
        actualizadoPor: e.personaDelGerente,
      });
      expect(delLocal[0]?.actualizadoEn).toBeInstanceOf(Date);
      expect(valorDe(await c.consultas.productosOcultos(e.gerente)).map((f) => f.nombre)).toEqual([
        "Café",
        "Flan",
        "Milanesa napolitana",
      ]);
      expect(await c.consultas.productosOcultos(e.operador)).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      expect(
        await c.consultas.productosOcultos(e.operador, { sucursalId: e.otraSucursal }),
      ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      const otra = await c.escenario();
      expect(valorDe(await c.consultas.productosOcultos(otra.gerente))).toEqual([]);
    });
  });
});

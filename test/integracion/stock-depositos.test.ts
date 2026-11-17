import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { LARGO_MAXIMO_DEL_NOMBRE_DE_ELECCION } from "../../src/primitivas/texto/nombre-de-eleccion";
import { productoDeBase, type ClaseDeUsoDePrueba } from "./catalogo-apoyo";
import { agotadaEnElResultado, codigoDe, repetirSiAgotada } from "./concurrencia-apoyo";
import {
  montarStock,
  nombreDeDeposito,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E5-T4: depósitos y artículos de stock (casos de uso y consulta) contra la base real y con las dependencias reales. Permisos por rol, alcance
 * de sucursal, aislamiento entre empresas, idempotencia (doble clic = un solo efecto; la misma clave con otro contenido, error), concurrencia
 * (dos altas con el mismo nombre, dos «de venta», desactivar mientras entra existencia, controlar a la vez) y el control de artículos (clases,
 * composición activa). Rondas de concurrencia: `PEDERNAL_RONDAS` (3 por defecto).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const RONDAS = (() => {
  const crudo = process.env["PEDERNAL_RONDAS"];
  const n = crudo === undefined ? 3 : Number(crudo);
  return Number.isInteger(n) && n >= 1 ? n : 3;
})();

describe.skipIf(base === null)("stock: depósitos y artículos", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const crear = async (extra: Record<string, unknown> = {}, quien = e.gerente) =>
    valorDe(
      await c.casos.crearDeposito(quien, {
        id: nuevoId(),
        sucursalId: e.sucursal,
        nombre: nombreDeDeposito(),
        uso: "NORMAL",
        deVenta: false,
        ...extra,
      }),
    ).depositoId;
  /** Una sucursal abierta y sin depósitos de la empresa de prueba (los «de venta» son uno por sucursal). */
  const sucursalNueva = async (): Promise<string> =>
    (
      await c.dueno.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
        [e.empresa, nombreDeDeposito("Sucursal")],
      )
    ).rows[0]?.id as string;
  const deposito = async (id: string) =>
    (await c.filas("select * from deposito where id = $1", [id]))[0];
  const contarDepositos = (empresa = e.empresa) =>
    c.contar("select count(*) as n from deposito where empresa_id = $1", [empresa]);
  /** Un producto controlable y su artículo, por el caso de uso real. */
  const controlado = async (clase: ClaseDeUsoDePrueba = "MATERIA_PRIMA") => {
    const producto = await productoDeBase(c.dueno, e.empresa, { clase });
    const articulo = valorDe(await c.casos.controlarArticulo(e.gerente, { productoId: producto }));
    return { producto, articulo: articulo.articuloId };
  };

  // =============================================================================================
  describe("crearDeposito", () => {
    it("el gerente lo crea (de uso normal, no de venta), con su sucursal y su nombre, y queda auditado", async () => {
      const id = nuevoId();
      const nombre = nombreDeDeposito("Cocina");
      expect(
        await c.casos.crearDeposito(e.gerente, {
          id,
          sucursalId: e.sucursal,
          nombre,
          uso: "NORMAL",
          deVenta: false,
        }),
      ).toEqual({ ok: true, valor: { depositoId: id, yaExistia: false } });
      expect(await deposito(id)).toMatchObject({
        empresa_id: e.empresa,
        sucursal_id: e.sucursal,
        nombre,
        nombre_clave: nombre.toLowerCase(),
        uso: "NORMAL",
        de_venta: false,
        activo: true,
        version: 1,
      });
      const registros = (await c.auditoria(e.empresa, "DEPOSITO_CREADO")).filter(
        (r) => r["entidad_id"] === id,
      );
      expect(registros).toHaveLength(1);
      expect(registros[0]).toMatchObject({
        actor_persona_id: e.personaDelGerente,
        entidad: "deposito",
        despues: { sucursalId: e.sucursal, nombre, uso: "NORMAL", deVenta: false },
      });
    });

    it("el administrador crea uno de cuarentena y uno de rechazo; el «de venta» solo puede ser de uso normal (USO_NO_VENDIBLE)", async () => {
      for (const uso of ["CUARENTENA", "RECHAZO"]) {
        const id = await crear({ uso }, e.administrador);
        expect((await deposito(id))?.["uso"]).toBe(uso);
      }
      const antes = await contarDepositos();
      expect(
        await c.casos.crearDeposito(e.gerente, {
          id: nuevoId(),
          sucursalId: e.sucursal,
          nombre: nombreDeDeposito(),
          uso: "CUARENTENA",
          deVenta: true,
        }),
      ).toEqual({ ok: false, error: "USO_NO_VENDIBLE" });
      expect(await contarDepositos()).toBe(antes);
    });

    it("valida lo que llega con lista de permitidos: id que no es uuid, nombre vacío, con caracteres no permitidos o largo, uso desconocido", async () => {
      const antes = await contarDepositos();
      const pedido = (extra: Record<string, unknown>) =>
        c.casos.crearDeposito(e.gerente, {
          id: nuevoId(),
          sucursalId: e.sucursal,
          nombre: nombreDeDeposito(),
          uso: "NORMAL",
          deVenta: false,
          ...extra,
        });
      expect(await pedido({ id: "no-es-un-uuid" })).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      for (const nombre of ["", "   ", "Fría\nOtra", "<b>Fría</b>", "Depósito 🍕", "=SUMA(A1)"]) {
        expect(await pedido({ nombre }), JSON.stringify(nombre)).toEqual({
          ok: false,
          error: "NOMBRE_INVALIDO",
        });
      }
      expect(await pedido({ nombre: "x".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_ELECCION + 1) })).toEqual(
        {
          ok: false,
          error: "NOMBRE_INVALIDO",
        },
      );
      for (const uso of ["", "normal", "OTRO", "NORMAL ", "de_venta"]) {
        expect(await pedido({ uso }), JSON.stringify(uso)).toEqual({
          ok: false,
          error: "USO_INVALIDO",
        });
      }
      expect(await contarDepositos()).toBe(antes);
    });

    it("el largo máximo del nombre es el de la base: con el máximo entra y la base y el caso de uso rechazan un carácter más", async () => {
      const id = await crear({ nombre: "n".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_ELECCION) });
      expect(String((await deposito(id))?.["nombre"]).length).toBe(
        LARGO_MAXIMO_DEL_NOMBRE_DE_ELECCION,
      );
      const base81 = "n".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_ELECCION + 1);
      await expect(
        c.dueno.query(
          "insert into deposito (empresa_id, sucursal_id, nombre, nombre_clave, uso) values ($1, $2, $3, $3, 'NORMAL')",
          [e.empresa, e.sucursal, base81],
        ),
      ).rejects.toMatchObject({ constraint: "deposito_nombre_ck" });
    });

    it("NOMBRE_DUPLICADO: el mismo nombre (aunque cambien mayúsculas) en la misma sucursal; en otra sucursal sí se puede", async () => {
      const nombre = nombreDeDeposito("Heladera");
      await crear({ nombre });
      const antes = await contarDepositos();
      expect(
        await c.casos.crearDeposito(e.gerente, {
          id: nuevoId(),
          sucursalId: e.sucursal,
          nombre: nombre.toUpperCase(),
          uso: "NORMAL",
          deVenta: false,
        }),
      ).toEqual({ ok: false, error: "NOMBRE_DUPLICADO" });
      expect(await contarDepositos()).toBe(antes);
      await crear({ nombre, sucursalId: e.otraSucursal });
      expect(await contarDepositos()).toBe(antes + 1);
    });

    it("la sucursal tiene que existir en la empresa y estar abierta: SUCURSAL_NO_ENCONTRADA (también con una de otra empresa) y SUCURSAL_INACTIVA", async () => {
      const otra = await c.escenario();
      const pedido = (sucursalId: string) =>
        c.casos.crearDeposito(e.gerente, {
          id: nuevoId(),
          sucursalId,
          nombre: nombreDeDeposito(),
          uso: "NORMAL",
          deVenta: false,
        });
      expect(await pedido(nuevoId())).toEqual({ ok: false, error: "SUCURSAL_NO_ENCONTRADA" });
      expect(await pedido(otra.sucursal)).toEqual({ ok: false, error: "SUCURSAL_NO_ENCONTRADA" });
      expect(await pedido("no-es-un-uuid")).toEqual({ ok: false, error: "SUCURSAL_NO_ENCONTRADA" });
      const { rows } = await c.dueno.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre, activa) values ($1, 'Cerrada', false) returning id",
        [e.empresa],
      );
      expect(await pedido(rows[0]?.id as string)).toEqual({
        ok: false,
        error: "SUCURSAL_INACTIVA",
      });
    });

    it("YA_HAY_DEPOSITO_DE_VENTA: un segundo «de venta» en la misma sucursal; en otra sucursal sí, y si el primero deja de serlo entra el segundo", async () => {
      const propia = await sucursalNueva();
      const otra = await sucursalNueva();
      const primero = await crear({ deVenta: true, sucursalId: propia });
      const antes = await contarDepositos();
      expect(
        await c.casos.crearDeposito(e.gerente, {
          id: nuevoId(),
          sucursalId: propia,
          nombre: nombreDeDeposito(),
          uso: "NORMAL",
          deVenta: true,
        }),
      ).toEqual({ ok: false, error: "YA_HAY_DEPOSITO_DE_VENTA" });
      expect(await contarDepositos()).toBe(antes);
      await crear({ deVenta: true, sucursalId: otra });
      const editado = valorDe(
        await c.casos.editarDeposito(e.gerente, {
          depositoId: primero,
          deVenta: false,
          versionEsperada: 1,
        }),
      );
      expect(editado).toEqual({ version: 2, yaEstaba: false });
      await crear({ deVenta: true, sucursalId: propia });
    });

    it("I1: repetir crearDeposito con el mismo id deja un depósito y devuelve yaExistia; con otro contenido, ID_REUTILIZADO", async () => {
      const id = nuevoId();
      const nombre = nombreDeDeposito("Repetido");
      const pedido = {
        id,
        sucursalId: e.sucursal,
        nombre,
        uso: "NORMAL",
        deVenta: false,
      };
      expect(valorDe(await c.casos.crearDeposito(e.gerente, pedido)).yaExistia).toBe(false);
      const antes = await contarDepositos();
      const registros = (await c.auditoria(e.empresa, "DEPOSITO_CREADO")).length;
      expect(await c.casos.crearDeposito(e.gerente, pedido)).toEqual({
        ok: true,
        valor: { depositoId: id, yaExistia: true },
      });
      expect(await contarDepositos()).toBe(antes);
      expect((await c.auditoria(e.empresa, "DEPOSITO_CREADO")).length).toBe(registros);
      for (const distinto of [
        { nombre: nombreDeDeposito("Otro") },
        { uso: "CUARENTENA" },
        { sucursalId: e.otraSucursal },
        { deVenta: true },
      ]) {
        expect(await c.casos.crearDeposito(e.gerente, { ...pedido, ...distinto })).toEqual({
          ok: false,
          error: "ID_REUTILIZADO",
        });
      }
      expect(await contarDepositos()).toBe(antes);
      expect((await deposito(id))?.["nombre"]).toBe(nombre);
    });
  });

  // =============================================================================================
  describe("editarDeposito", () => {
    it("cambia el nombre (la clave sigue al nombre), sube la versión y audita antes y después; DEPOSITO_DESACTUALIZADO con una versión vieja", async () => {
      const id = await crear();
      const nuevo = nombreDeDeposito("Renombrado");
      expect(
        await c.casos.editarDeposito(e.gerente, {
          depositoId: id,
          nombre: nuevo,
          versionEsperada: 1,
        }),
      ).toEqual({ ok: true, valor: { version: 2, yaEstaba: false } });
      expect(await deposito(id)).toMatchObject({
        nombre: nuevo,
        nombre_clave: nuevo.toLowerCase(),
        version: 2,
      });
      const registro = (await c.auditoria(e.empresa, "DEPOSITO_EDITADO")).filter(
        (r) => r["entidad_id"] === id,
      );
      expect(registro).toHaveLength(1);
      expect(registro[0]).toMatchObject({ despues: { nombre: nuevo } });
      expect(
        await c.casos.editarDeposito(e.gerente, {
          depositoId: id,
          nombre: nombreDeDeposito("Tarde"),
          versionEsperada: 1,
        }),
      ).toEqual({ ok: false, error: "DEPOSITO_DESACTUALIZADO" });
      expect((await deposito(id))?.["nombre"]).toBe(nuevo);
    });

    it("I2: repetir editarDeposito ya aplicado devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar", async () => {
      const id = await crear();
      const nuevo = nombreDeDeposito("Dos veces");
      const pedido = { depositoId: id, nombre: nuevo, versionEsperada: 1 };
      expect(valorDe(await c.casos.editarDeposito(e.gerente, pedido))).toEqual({
        version: 2,
        yaEstaba: false,
      });
      const registros = (await c.auditoria(e.empresa, "DEPOSITO_EDITADO")).length;
      expect(await c.casos.editarDeposito(e.gerente, pedido)).toEqual({
        ok: true,
        valor: { version: 2, yaEstaba: true },
      });
      // Pedir lo mismo sin nada que cambiar tampoco escribe.
      expect(
        await c.casos.editarDeposito(e.gerente, { depositoId: id, versionEsperada: 7 }),
      ).toEqual({ ok: true, valor: { version: 2, yaEstaba: true } });
      expect((await deposito(id))?.["version"]).toBe(2);
      expect((await c.auditoria(e.empresa, "DEPOSITO_EDITADO")).length).toBe(registros);
    });

    it("hacerlo «de venta» y quitárselo; no se renombra a un nombre que ya existe (NOMBRE_DUPLICADO); el de cuarentena no puede ser de venta; el uso no cambia", async () => {
      const otraSucursal = { sucursalId: await sucursalNueva() };
      const id = await crear(otraSucursal);
      const ocupado = nombreDeDeposito("Ocupado");
      await crear({ ...otraSucursal, nombre: ocupado });
      expect(
        await c.casos.editarDeposito(e.gerente, {
          depositoId: id,
          nombre: ocupado.toUpperCase(),
          versionEsperada: 1,
        }),
      ).toEqual({ ok: false, error: "NOMBRE_DUPLICADO" });
      expect(
        await c.casos.editarDeposito(e.gerente, {
          depositoId: id,
          deVenta: true,
          versionEsperada: 1,
        }),
      ).toEqual({ ok: true, valor: { version: 2, yaEstaba: false } });
      expect((await deposito(id))?.["de_venta"]).toBe(true);
      // Hay otro de venta en esa sucursal: uno solo.
      const otro = await crear(otraSucursal);
      expect(
        await c.casos.editarDeposito(e.gerente, {
          depositoId: otro,
          deVenta: true,
          versionEsperada: 1,
        }),
      ).toEqual({ ok: false, error: "YA_HAY_DEPOSITO_DE_VENTA" });
      const cuarentena = await crear({ uso: "CUARENTENA" });
      expect(
        await c.casos.editarDeposito(e.gerente, {
          depositoId: cuarentena,
          deVenta: true,
          versionEsperada: 1,
        }),
      ).toEqual({ ok: false, error: "USO_NO_VENDIBLE" });
      expect(
        await c.casos.editarDeposito(e.gerente, {
          depositoId: otro,
          nombre: "Fría\nOtra",
          versionEsperada: 1,
        }),
      ).toEqual({ ok: false, error: "NOMBRE_INVALIDO" });
      // El uso no se edita: la base lo rechaza aun con SQL directo.
      await expect(
        c.dueno.query("update deposito set uso = 'RECHAZO' where id = $1", [otro]),
      ).rejects.toMatchObject({ constraint: "deposito_uso_inmutable" });
    });
  });

  // =============================================================================================
  describe("desactivarDeposito y reactivarDeposito", () => {
    it("desactivar y reactivar un depósito vacío; un depósito inexistente o de otra empresa es DEPOSITO_NO_ENCONTRADO", async () => {
      const id = await crear();
      expect(await c.casos.desactivarDeposito(e.gerente, { depositoId: id })).toEqual({
        ok: true,
        valor: { yaEstaba: false },
      });
      expect((await deposito(id))?.["activo"]).toBe(false);
      expect(await c.casos.reactivarDeposito(e.gerente, { depositoId: id })).toEqual({
        ok: true,
        valor: { yaEstaba: false },
      });
      expect((await deposito(id))?.["activo"]).toBe(true);
      const acciones = (await c.auditoria(e.empresa)).filter((r) => r["entidad_id"] === id);
      expect(acciones.map((r) => r["accion"])).toEqual([
        "DEPOSITO_CREADO",
        "DEPOSITO_DESACTIVADO",
        "DEPOSITO_REACTIVADO",
      ]);
      const otra = await c.escenario();
      for (const falta of [nuevoId(), "no-es-un-uuid"]) {
        expect(await c.casos.desactivarDeposito(e.gerente, { depositoId: falta })).toEqual({
          ok: false,
          error: "DEPOSITO_NO_ENCONTRADO",
        });
        expect(await c.casos.reactivarDeposito(e.gerente, { depositoId: falta })).toEqual({
          ok: false,
          error: "DEPOSITO_NO_ENCONTRADO",
        });
        expect(
          await c.casos.editarDeposito(e.gerente, { depositoId: falta, versionEsperada: 1 }),
        ).toEqual({ ok: false, error: "DEPOSITO_NO_ENCONTRADO" });
      }
      expect(await c.casos.desactivarDeposito(otra.gerente, { depositoId: id })).toEqual({
        ok: false,
        error: "DEPOSITO_NO_ENCONTRADO",
      });
      expect((await deposito(id))?.["activo"]).toBe(true);
    });

    it("I3: desactivar dos veces es ok, no escribe ni audita la segunda", async () => {
      const id = await crear();
      expect(valorDe(await c.casos.desactivarDeposito(e.gerente, { depositoId: id }))).toEqual({
        yaEstaba: false,
      });
      const registros = (await c.auditoria(e.empresa, "DEPOSITO_DESACTIVADO")).length;
      const version = (await deposito(id))?.["version"];
      expect(await c.casos.desactivarDeposito(e.gerente, { depositoId: id })).toEqual({
        ok: true,
        valor: { yaEstaba: true },
      });
      expect((await c.auditoria(e.empresa, "DEPOSITO_DESACTIVADO")).length).toBe(registros);
      expect((await deposito(id))?.["version"]).toBe(version);
    });

    it("I3: reactivar dos veces es ok, no escribe ni audita la segunda", async () => {
      const id = await crear();
      // Ya activo: no hay nada que reactivar.
      expect(await c.casos.reactivarDeposito(e.gerente, { depositoId: id })).toEqual({
        ok: true,
        valor: { yaEstaba: true },
      });
      valorDe(await c.casos.desactivarDeposito(e.gerente, { depositoId: id }));
      valorDe(await c.casos.reactivarDeposito(e.gerente, { depositoId: id }));
      const registros = (await c.auditoria(e.empresa, "DEPOSITO_REACTIVADO")).length;
      const version = (await deposito(id))?.["version"];
      expect(await c.casos.reactivarDeposito(e.gerente, { depositoId: id })).toEqual({
        ok: true,
        valor: { yaEstaba: true },
      });
      expect((await c.auditoria(e.empresa, "DEPOSITO_REACTIVADO")).length).toBe(registros);
      expect((await deposito(id))?.["version"]).toBe(version);
    });

    it("no se desactiva el «de venta» (ES_EL_DE_VENTA), ni uno con existencia (DEPOSITO_CON_EXISTENCIA), ni uno con un conteo abierto (DEPOSITO_CON_CONTEO_ABIERTO)", async () => {
      const deVenta = await crear({ deVenta: true, sucursalId: await sucursalNueva() });
      expect(await c.casos.desactivarDeposito(e.gerente, { depositoId: deVenta })).toEqual({
        ok: false,
        error: "ES_EL_DE_VENTA",
      });
      expect((await deposito(deVenta))?.["activo"]).toBe(true);

      const conStock = await crear();
      const { articulo } = await controlado();
      valorDe(
        await c.entrar(e.gerente, { depositoId: conStock, articuloId: articulo, cantidad: "2" }),
      );
      expect(await c.casos.desactivarDeposito(e.gerente, { depositoId: conStock })).toEqual({
        ok: false,
        error: "DEPOSITO_CON_EXISTENCIA",
      });
      expect((await deposito(conStock))?.["activo"]).toBe(true);

      const conConteo = await crear();
      await c.dueno.query(
        "insert into conteo_fisico (id, empresa_id, deposito_id, abierto_por, abierto_en) values ($1, $2, $3, $4, now())",
        [nuevoId(), e.empresa, conConteo, e.personaDelGerente],
      );
      expect(await c.casos.desactivarDeposito(e.gerente, { depositoId: conConteo })).toEqual({
        ok: false,
        error: "DEPOSITO_CON_CONTEO_ABIERTO",
      });
      expect((await deposito(conConteo))?.["activo"]).toBe(true);
    });
  });

  // =============================================================================================
  describe("permisos, alcance, módulo y empresa", () => {
    it("el operador no maneja depósitos ni artículos (SIN_PERMISO) pero ve la lista de sus sucursales; el administrador sí maneja todo", async () => {
      const id = await crear();
      const producto = await productoDeBase(c.dueno, e.empresa, { clase: "INSUMO" });
      const antes = await contarDepositos();
      const sinPermiso = { ok: false, error: "SIN_PERMISO" };
      expect(
        await c.casos.crearDeposito(e.operador, {
          id: nuevoId(),
          sucursalId: e.sucursal,
          nombre: nombreDeDeposito(),
          uso: "NORMAL",
          deVenta: false,
        }),
      ).toEqual(sinPermiso);
      expect(
        await c.casos.editarDeposito(e.operador, {
          depositoId: id,
          nombre: "Nuevo",
          versionEsperada: 1,
        }),
      ).toEqual(sinPermiso);
      expect(await c.casos.desactivarDeposito(e.operador, { depositoId: id })).toEqual(sinPermiso);
      expect(await c.casos.reactivarDeposito(e.operador, { depositoId: id })).toEqual(sinPermiso);
      expect(await c.casos.controlarArticulo(e.operador, { productoId: producto })).toEqual(
        sinPermiso,
      );
      expect(await c.casos.dejarDeControlar(e.operador, { productoId: producto })).toEqual(
        sinPermiso,
      );
      expect(await contarDepositos()).toBe(antes);
      expect((await deposito(id))?.["activo"]).toBe(true);
      expect(valorDe(await c.consultas.listarDepositos(e.operador)).some((d) => d.id === id)).toBe(
        true,
      );
      // El administrador hace todo lo que el operador no puede.
      const creado = await crear({}, e.administrador);
      valorDe(await c.casos.desactivarDeposito(e.administrador, { depositoId: creado }));
      valorDe(await c.casos.controlarArticulo(e.administrador, { productoId: producto }));
      // Sin persona (el sistema) nadie autoriza nada.
      expect(
        await c.casos.crearDeposito(
          { ...e.gerente, personaId: null },
          {
            id: nuevoId(),
            sucursalId: e.sucursal,
            nombre: "Sistema",
            uso: "NORMAL",
            deVenta: false,
          },
        ),
      ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
    });

    it("un administrador con alcance de una sola sucursal maneja los depósitos de la suya y no los de otra (SUCURSAL_FUERA_DE_ALCANCE), ni lo que es de toda la empresa", async () => {
      const fuera = { ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" };
      const propio = await crear({}, e.administradorDeUnaSucursal);
      const ajeno = await crear({ sucursalId: e.otraSucursal });
      const producto = await productoDeBase(c.dueno, e.empresa, { clase: "INSUMO" });
      expect(
        await c.casos.crearDeposito(e.administradorDeUnaSucursal, {
          id: nuevoId(),
          sucursalId: e.otraSucursal,
          nombre: nombreDeDeposito(),
          uso: "NORMAL",
          deVenta: false,
        }),
      ).toEqual(fuera);
      expect(
        await c.casos.editarDeposito(e.administradorDeUnaSucursal, {
          depositoId: ajeno,
          nombre: nombreDeDeposito(),
          versionEsperada: 1,
        }),
      ).toEqual(fuera);
      expect(
        await c.casos.desactivarDeposito(e.administradorDeUnaSucursal, { depositoId: ajeno }),
      ).toEqual(fuera);
      expect(
        await c.casos.reactivarDeposito(e.administradorDeUnaSucursal, { depositoId: ajeno }),
      ).toEqual(fuera);
      expect((await deposito(ajeno))?.["activo"]).toBe(true);
      valorDe(
        await c.casos.desactivarDeposito(e.administradorDeUnaSucursal, { depositoId: propio }),
      );
      // Controlar un artículo es de la empresa entera: exige alcance sobre todas las sucursales.
      expect(
        await c.casos.controlarArticulo(e.administradorDeUnaSucursal, { productoId: producto }),
      ).toEqual(fuera);
      expect(
        await c.casos.dejarDeControlar(e.administradorDeUnaSucursal, { productoId: producto }),
      ).toEqual(fuera);
    });

    it("con el módulo stock apagado para la empresa se rechaza todo (MODULO_NO_ACTIVO), también las consultas, y nada se escribe", async () => {
      const id = await crear();
      const producto = await productoDeBase(c.dueno, e.empresa, { clase: "INSUMO" });
      const antes = await contarDepositos();
      c.apagarModulo("stock");
      try {
        const apagado = { ok: false, error: "MODULO_NO_ACTIVO" };
        expect(
          await c.casos.crearDeposito(e.gerente, {
            id: nuevoId(),
            sucursalId: e.sucursal,
            nombre: nombreDeDeposito(),
            uso: "NORMAL",
            deVenta: false,
          }),
        ).toEqual(apagado);
        expect(await c.casos.desactivarDeposito(e.gerente, { depositoId: id })).toEqual(apagado);
        expect(await c.casos.controlarArticulo(e.gerente, { productoId: producto })).toEqual(
          apagado,
        );
        expect(await c.consultas.listarDepositos(e.gerente)).toEqual(apagado);
      } finally {
        c.encenderModulos();
      }
      expect(await contarDepositos()).toBe(antes);
      expect((await deposito(id))?.["activo"]).toBe(true);
    });

    for (const caso of [
      { nombre: "suspendida", motivo: "EMPRESA_SUSPENDIDA" },
      { nombre: "con el tenant suspendido", motivo: "TENANT_SUSPENDIDO" },
    ] as const) {
      it(`una empresa ${caso.nombre} no maneja depósitos ni artículos: EMPRESA_NO_OPERA y nada escrito`, async () => {
        const otra = await c.escenario();
        const id = nuevoId();
        const producto = await productoDeBase(c.dueno, otra.empresa, { clase: "INSUMO" });
        valorDe(
          await c.casos.crearDeposito(otra.gerente, {
            id,
            sucursalId: otra.sucursal,
            nombre: "Previo",
            uso: "NORMAL",
            deVenta: false,
          }),
        );
        if (caso.motivo === "EMPRESA_SUSPENDIDA") {
          await c.dueno.query(
            "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
            [otra.empresa],
          );
        } else {
          await c.dueno.query(
            "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = (select tenant_id from empresa where id = $1)",
            [otra.empresa],
          );
        }
        const esperado = {
          ok: false,
          error: { codigo: "EMPRESA_NO_OPERA", empresaId: otra.empresa, motivo: caso.motivo },
        };
        expect(
          await c.casos.crearDeposito(otra.gerente, {
            id: nuevoId(),
            sucursalId: otra.sucursal,
            nombre: "Nuevo",
            uso: "NORMAL",
            deVenta: false,
          }),
        ).toEqual(esperado);
        expect(await c.casos.desactivarDeposito(otra.gerente, { depositoId: id })).toEqual(
          esperado,
        );
        expect(await c.casos.controlarArticulo(otra.gerente, { productoId: producto })).toEqual(
          esperado,
        );
        expect(
          await c.contar("select count(*) as n from deposito where empresa_id = $1", [
            otra.empresa,
          ]),
        ).toBe(1);
        expect(
          await c.contar("select count(*) as n from articulo_de_stock where empresa_id = $1", [
            otra.empresa,
          ]),
        ).toBe(0);
      });
    }

    it("aislamiento: la empresa B no ve, edita ni desactiva los depósitos y artículos de la A; reutilizar su id es ID_REUTILIZADO sin filtrar nada, y el mismo nombre en otra empresa es otro depósito", async () => {
      const b = await c.escenario();
      const nombre = nombreDeDeposito("Compartido");
      const deA = await crear({ nombre });
      const { producto } = await controlado();
      expect(
        await c.casos.crearDeposito(b.gerente, {
          id: deA,
          sucursalId: b.sucursal,
          nombre: "Otro",
          uso: "NORMAL",
          deVenta: false,
        }),
      ).toEqual({ ok: false, error: "ID_REUTILIZADO" });
      expect(
        await c.casos.editarDeposito(b.gerente, {
          depositoId: deA,
          nombre: "Robado",
          versionEsperada: 1,
        }),
      ).toEqual({ ok: false, error: "DEPOSITO_NO_ENCONTRADO" });
      expect(await c.casos.controlarArticulo(b.gerente, { productoId: producto })).toEqual({
        ok: false,
        error: "PRODUCTO_NO_ENCONTRADO",
      });
      expect(await c.casos.dejarDeControlar(b.gerente, { productoId: producto })).toEqual({
        ok: false,
        error: "PRODUCTO_NO_ENCONTRADO",
      });
      expect(
        await c.casos.crearDeposito(b.gerente, {
          id: nuevoId(),
          sucursalId: e.sucursal,
          nombre: "En sucursal ajena",
          uso: "NORMAL",
          deVenta: false,
        }),
      ).toEqual({ ok: false, error: "SUCURSAL_NO_ENCONTRADA" });
      expect(valorDe(await c.consultas.listarDepositos(b.gerente))).toEqual([]);
      const propio = valorDe(
        await c.casos.crearDeposito(b.gerente, {
          id: nuevoId(),
          sucursalId: b.sucursal,
          nombre,
          uso: "NORMAL",
          deVenta: true,
        }),
      );
      expect(propio.yaExistia).toBe(false);
      expect((await deposito(deA))?.["nombre"]).toBe(nombre);
      expect(valorDe(await c.consultas.listarDepositos(b.gerente)).map((d) => d.id)).toEqual([
        propio.depositoId,
      ]);
    });
  });

  // =============================================================================================
  describe("listarDepositos", () => {
    it("el gerente ve todos (activos e inactivos) por sucursal y nombre; el operador solo los de su sucursal; una sucursal ajena sale vacía", async () => {
      const m = await c.escenario();
      const crearEn = async (sucursalId: string, nombre: string, extra = {}) =>
        valorDe(
          await c.casos.crearDeposito(m.gerente, {
            id: nuevoId(),
            sucursalId,
            nombre,
            uso: "NORMAL",
            deVenta: false,
            ...extra,
          }),
        ).depositoId;
      const b = await crearEn(m.sucursal, "Barra");
      const a = await crearEn(m.sucursal, "Alacena", { deVenta: true });
      const f = await crearEn(m.otraSucursal, "Fría", { uso: "CUARENTENA" });
      valorDe(await c.casos.desactivarDeposito(m.gerente, { depositoId: b }));
      const todos = valorDe(await c.consultas.listarDepositos(m.gerente));
      expect(todos.map((d) => d.id).sort()).toEqual([a, b, f].sort());
      const propios = todos.filter((d) => d.sucursalId === m.sucursal);
      expect(propios.map((d) => d.nombre)).toEqual(["Alacena", "Barra"]);
      expect(todos.find((d) => d.id === b)).toMatchObject({ activo: false, version: 2 });
      expect(todos.find((d) => d.id === a)).toMatchObject({ deVenta: true, uso: "NORMAL" });
      expect(todos.find((d) => d.id === f)).toMatchObject({ uso: "CUARENTENA", activo: true });
      expect(
        valorDe(await c.consultas.listarDepositos(m.gerente, { sucursalId: m.otraSucursal })).map(
          (d) => d.id,
        ),
      ).toEqual([f]);
      expect(
        valorDe(await c.consultas.listarDepositos(m.operador))
          .map((d) => d.id)
          .sort(),
      ).toEqual([a, b].sort());
      expect(
        valorDe(await c.consultas.listarDepositos(m.operador, { sucursalId: m.otraSucursal })),
      ).toEqual([]);
      expect(valorDe(await c.consultas.listarDepositos(m.gerente, { sucursalId: "x" }))).toEqual(
        [],
      );
      // Un operador sin ninguna sucursal asignada no ve ninguno.
      c.alcances.set(String(m.operador.personaId), []);
      expect(valorDe(await c.consultas.listarDepositos(m.operador))).toEqual([]);
    });
  });

  // =============================================================================================
  describe("controlarArticulo y dejarDeControlar", () => {
    it("controla la materia prima, el insumo y la reventa con la unidad base del producto, y lo audita; el elaborado y el vendible no (CLASE_NO_CONTROLABLE)", async () => {
      for (const clase of ["MATERIA_PRIMA", "INSUMO", "REVENTA"] as const) {
        const producto = await productoDeBase(c.dueno, e.empresa, {
          clase,
          unidadBase: "KILOGRAMO",
          dimension: "MASA",
        });
        const resultado = valorDe(
          await c.casos.controlarArticulo(e.gerente, { productoId: producto }),
        );
        expect(resultado.yaExistia).toBe(false);
        expect(
          (
            await c.filas("select * from articulo_de_stock where id = $1", [resultado.articuloId])
          )[0],
        ).toMatchObject({
          empresa_id: e.empresa,
          producto_id: producto,
          unidad_de_stock_id: "KILOGRAMO",
          dimension: "MASA",
          activo: true,
        });
        const registro = (await c.auditoria(e.empresa, "ARTICULO_CONTROLADO")).filter(
          (r) => r["entidad_id"] === resultado.articuloId,
        );
        expect(registro).toHaveLength(1);
        expect(registro[0]).toMatchObject({
          entidad: "articulo_de_stock",
          despues: { productoId: producto, unidadDeStockId: "KILOGRAMO", activo: true },
        });
      }
      for (const clase of ["ELABORADO", "VENDIBLE"] as const) {
        const producto = await productoDeBase(c.dueno, e.empresa, { clase });
        expect(await c.casos.controlarArticulo(e.gerente, { productoId: producto })).toEqual({
          ok: false,
          error: "CLASE_NO_CONTROLABLE",
        });
        expect(
          await c.contar("select count(*) as n from articulo_de_stock where producto_id = $1", [
            producto,
          ]),
        ).toBe(0);
      }
    });

    it("PRODUCTO_NO_ENCONTRADO (inexistente o que no es un uuid) y PRODUCTO_INACTIVO", async () => {
      for (const productoId of [nuevoId(), "no-es-un-uuid"]) {
        expect(await c.casos.controlarArticulo(e.gerente, { productoId })).toEqual({
          ok: false,
          error: "PRODUCTO_NO_ENCONTRADO",
        });
        expect(await c.casos.dejarDeControlar(e.gerente, { productoId })).toEqual({
          ok: false,
          error: "PRODUCTO_NO_ENCONTRADO",
        });
      }
      const inactivo = await productoDeBase(c.dueno, e.empresa, { clase: "INSUMO", activo: false });
      expect(await c.casos.controlarArticulo(e.gerente, { productoId: inactivo })).toEqual({
        ok: false,
        error: "PRODUCTO_INACTIVO",
      });
      expect(
        await c.contar("select count(*) as n from articulo_de_stock where producto_id = $1", [
          inactivo,
        ]),
      ).toBe(0);
    });

    it("I4: controlar dos veces el mismo producto deja un artículo, devuelve yaExistia y no audita la segunda", async () => {
      const producto = await productoDeBase(c.dueno, e.empresa, { clase: "INSUMO" });
      const primera = valorDe(await c.casos.controlarArticulo(e.gerente, { productoId: producto }));
      expect(primera.yaExistia).toBe(false);
      const registros = (await c.auditoria(e.empresa, "ARTICULO_CONTROLADO")).length;
      expect(await c.casos.controlarArticulo(e.gerente, { productoId: producto })).toEqual({
        ok: true,
        valor: { articuloId: primera.articuloId, yaExistia: true },
      });
      expect(
        await c.contar("select count(*) as n from articulo_de_stock where producto_id = $1", [
          producto,
        ]),
      ).toBe(1);
      expect((await c.auditoria(e.empresa, "ARTICULO_CONTROLADO")).length).toBe(registros);
    });

    it("I4: dejar de controlar dos veces es ok y no audita la segunda", async () => {
      const { producto } = await controlado("REVENTA");
      expect(await c.casos.dejarDeControlar(e.gerente, { productoId: producto })).toEqual({
        ok: true,
        valor: { yaEstaba: false },
      });
      const registros = (await c.auditoria(e.empresa, "ARTICULO_DEJADO_DE_CONTROLAR")).length;
      expect(await c.casos.dejarDeControlar(e.gerente, { productoId: producto })).toEqual({
        ok: true,
        valor: { yaEstaba: true },
      });
      expect((await c.auditoria(e.empresa, "ARTICULO_DEJADO_DE_CONTROLAR")).length).toBe(registros);
      const nunca = await productoDeBase(c.dueno, e.empresa, { clase: "INSUMO" });
      expect(await c.casos.dejarDeControlar(e.gerente, { productoId: nunca })).toEqual({
        ok: true,
        valor: { yaEstaba: true },
      });
      expect(
        await c.contar("select count(*) as n from articulo_de_stock where producto_id = $1", [
          nunca,
        ]),
      ).toBe(0);
    });

    it("dejar de controlar no borra nada: el artículo queda inactivo con su libro y su saldo, y volver a controlar reactiva el MISMO artículo", async () => {
      const { producto, articulo } = await controlado();
      const deposito_ = await crear();
      valorDe(
        await c.entrar(e.gerente, { depositoId: deposito_, articuloId: articulo, cantidad: "5" }),
      );
      expect(await c.casos.dejarDeControlar(e.gerente, { productoId: producto })).toEqual({
        ok: true,
        valor: { yaEstaba: false },
      });
      expect(
        (await c.filas("select activo from articulo_de_stock where id = $1", [articulo]))[0],
      ).toMatchObject({ activo: false });
      expect(
        await c.contar("select count(*) as n from renglon_de_movimiento where articulo_id = $1", [
          articulo,
        ]),
      ).toBe(1);
      expect(
        (
          await c.filas("select existencia::text as e from saldo_de_stock where articulo_id = $1", [
            articulo,
          ])
        )[0],
      ).toMatchObject({ e: "5.0000" });
      // Un artículo inactivo no admite movimientos nuevos.
      const sinMovimiento = await c.entrar(e.gerente, {
        depositoId: deposito_,
        articuloId: articulo,
        cantidad: "1",
      });
      expect(sinMovimiento).toMatchObject({
        ok: false,
        error: { tipo: "Check", restriccion: "renglon_articulo_inactivo" },
      });
      expect(await c.casos.controlarArticulo(e.gerente, { productoId: producto })).toEqual({
        ok: true,
        valor: { articuloId: articulo, yaExistia: false },
      });
      expect(
        await c.contar("select count(*) as n from articulo_de_stock where producto_id = $1", [
          producto,
        ]),
      ).toBe(1);
      expect(
        (await c.auditoria(e.empresa, "ARTICULO_CONTROLADO")).filter(
          (r) => r["entidad_id"] === articulo,
        ),
      ).toHaveLength(2);
      valorDe(
        await c.entrar(e.gerente, { depositoId: deposito_, articuloId: articulo, cantidad: "1" }),
      );
    });

    it("ARTICULO_EN_COMPOSICION_ACTIVA: no se deja de controlar un artículo que usa la composición vigente de un producto; con la receta retirada, sí", async () => {
      const { producto, articulo } = await controlado();
      const vendible = await productoDeBase(c.dueno, e.empresa, { clase: "VENDIBLE" });
      const version = (numero: number, componentes: readonly string[]) =>
        c.entorno.ejecutar({ contexto: e.gerente }, async (tx) => ({
          ok: true as const,
          valor: await tx.composicionesDeStock.insertarVersion(e.empresaId, {
            productoId: vendible,
            numero,
            rinde: "1",
            creadaPor: e.personaDelGerente,
            creadaEn: e.gerente.ahora,
            componentes: componentes.map((articuloId) => ({
              articuloId,
              cantidad: "2",
              unidadId: "UNIDAD",
              dimension: "CONTEO",
            })),
          }),
        }));
      valorDe(await version(1, [articulo]));
      expect(await c.casos.dejarDeControlar(e.gerente, { productoId: producto })).toEqual({
        ok: false,
        error: "ARTICULO_EN_COMPOSICION_ACTIVA",
      });
      expect(
        (await c.filas("select activo from articulo_de_stock where id = $1", [articulo]))[0],
      ).toMatchObject({ activo: true });
      // Una versión vacía retira la receta: ya no está en la composición vigente.
      valorDe(await version(2, []));
      expect(await c.casos.dejarDeControlar(e.gerente, { productoId: producto })).toEqual({
        ok: true,
        valor: { yaEstaba: false },
      });
    });
  });

  // =============================================================================================
  describe("concurrencia real", () => {
    /** El pedido se repite si pierde por agotamiento: es el mismo pedido, seguro por su identidad. */
    const firme = <R extends { readonly ok: boolean }>(trabajo: () => Promise<R>) =>
      repetirSiAgotada(trabajo, { esAgotada: (r) => agotadaEnElResultado(r as never) });
    /** Pedidos a la vez, con la barrera armada: todos empezaron antes de que cualquiera escriba. Se alterna cuál sale primero. */
    const aLaVez = async <T>(pedidos: ReadonlyArray<() => Promise<T>>, ronda: number) => {
      c.armarBarrera(pedidos.length);
      try {
        const orden = ronda % 2 === 0 ? [...pedidos] : [...pedidos].reverse();
        return await Promise.all(orden.map((p) => p()));
      } finally {
        c.soltarBarrera();
      }
    };
    const soloOk = <R extends { readonly ok: boolean }>(resultados: readonly R[]) =>
      resultados.filter((r) => r.ok).length;

    it("C1: dos crearDeposito con el mismo nombre en la misma sucursal a la vez: gana uno y el otro ve NOMBRE_DUPLICADO; queda uno solo", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const m = await c.escenario();
        const nombre = nombreDeDeposito("Carrera");
        const pedido = () =>
          firme(() =>
            c.casos.crearDeposito(m.gerente, {
              id: nuevoId(),
              sucursalId: m.sucursal,
              nombre,
              uso: "NORMAL",
              deVenta: false,
            }),
          );
        const resultados = await aLaVez([pedido, pedido], ronda);
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(1);
        expect(resultados.filter((r) => !r.ok).map(codigoDe)).toEqual(["NOMBRE_DUPLICADO"]);
        expect(
          await c.contar("select count(*) as n from deposito where empresa_id = $1", [m.empresa]),
        ).toBe(1);
      }
    });

    it("C2: dos crearDeposito «de venta» a la vez en la misma sucursal: gana uno y el otro ve YA_HAY_DEPOSITO_DE_VENTA; nunca dos de venta", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const m = await c.escenario();
        const pedido = () =>
          firme(() =>
            c.casos.crearDeposito(m.gerente, {
              id: nuevoId(),
              sucursalId: m.sucursal,
              nombre: nombreDeDeposito("Venta"),
              uso: "NORMAL",
              deVenta: true,
            }),
          );
        const resultados = await aLaVez([pedido, pedido], ronda);
        expect(soloOk(resultados), JSON.stringify(resultados)).toBe(1);
        expect(resultados.filter((r) => !r.ok).map(codigoDe)).toEqual(["YA_HAY_DEPOSITO_DE_VENTA"]);
        expect(
          await c.contar(
            "select count(*) as n from deposito where empresa_id = $1 and de_venta and activo",
            [m.empresa],
          ),
        ).toBe(1);
      }
    });

    it("C3: el mismo crearDeposito dos veces a la vez (doble clic): un solo depósito, y los dos responden bien (uno con yaExistia)", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const m = await c.escenario();
        const id = nuevoId();
        const nombre = nombreDeDeposito("Doble clic");
        const pedido = () =>
          firme(() =>
            c.casos.crearDeposito(m.gerente, {
              id,
              sucursalId: m.sucursal,
              nombre,
              uso: "NORMAL",
              deVenta: true,
            }),
          );
        const resultados = await aLaVez([pedido, pedido], ronda);
        expect(
          resultados.every((r) => r.ok),
          JSON.stringify(resultados),
        ).toBe(true);
        expect(resultados.map((r) => r.ok && r.valor.yaExistia).sort()).toEqual([false, true]);
        expect(
          await c.contar("select count(*) as n from deposito where empresa_id = $1", [m.empresa]),
        ).toBe(1);
        expect(
          (await c.auditoria(m.empresa, "DEPOSITO_CREADO")).filter((r) => r["entidad_id"] === id),
        ).toHaveLength(1);
      }
    });

    it("C4: desactivar un depósito mientras le entra mercadería: gana una de las dos y el depósito nunca queda inactivo con existencia", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const m = await c.escenario();
        const depositoId = valorDe(
          await c.casos.crearDeposito(m.gerente, {
            id: nuevoId(),
            sucursalId: m.sucursal,
            nombre: nombreDeDeposito("Entra"),
            uso: "NORMAL",
            deVenta: false,
          }),
        ).depositoId;
        const producto = await productoDeBase(c.dueno, m.empresa, { clase: "INSUMO" });
        const articuloId = valorDe(
          await c.casos.controlarArticulo(m.gerente, { productoId: producto }),
        ).articuloId;
        const desactivar = () => firme(() => c.casos.desactivarDeposito(m.gerente, { depositoId }));
        const entrar = () =>
          firme(() => c.entrar(m.gerente, { depositoId, articuloId, cantidad: "3" }));
        const resultados = await aLaVez<{ ok: boolean; error?: unknown }>(
          [desactivar, entrar],
          ronda,
        );
        expect(
          resultados.filter((r) => r.ok).length,
          JSON.stringify(resultados),
        ).toBeGreaterThanOrEqual(1);
        const guardado = (
          await c.filas("select activo from deposito where id = $1", [depositoId])
        )[0] as { activo: boolean };
        const existencia = Number(
          (
            await c.filas(
              "select coalesce(sum(existencia), 0)::text as e from saldo_de_stock where deposito_id = $1",
              [depositoId],
            )
          )[0]?.["e"],
        );
        // Nunca inactivo con existencia: o entró y el depósito sigue activo, o se desactivó y no entró nada.
        expect(guardado.activo === false && existencia !== 0).toBe(false);
        const perdedor = resultados.find((r) => !r.ok);
        if (perdedor !== undefined) {
          const error = JSON.stringify(perdedor.error);
          expect(
            error.includes("DEPOSITO_CON_EXISTENCIA") || error.includes("deposito_inactivo"),
            error,
          ).toBe(true);
        }
      }
    });

    it("C5: dos controlarArticulo del mismo producto a la vez: un solo artículo; uno responde yaExistia", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const producto = await productoDeBase(c.dueno, e.empresa, { clase: "INSUMO" });
        const pedido = () =>
          firme(() => c.casos.controlarArticulo(e.gerente, { productoId: producto }));
        const resultados = await aLaVez([pedido, pedido], ronda);
        expect(
          resultados.every((r) => r.ok),
          JSON.stringify(resultados),
        ).toBe(true);
        expect(resultados.map((r) => r.ok && r.valor.yaExistia).sort()).toEqual([false, true]);
        expect(
          await c.contar("select count(*) as n from articulo_de_stock where producto_id = $1", [
            producto,
          ]),
        ).toBe(1);
        expect(
          (await c.auditoria(e.empresa, "ARTICULO_CONTROLADO")).filter(
            (r) => (r["despues"] as { productoId?: string }).productoId === producto,
          ),
        ).toHaveLength(1);
      }
    });

    it("C6: dejar de controlar un artículo mientras otra sesión lo suma a una composición: nunca queda inactivo dentro de la composición vigente", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const m = await c.escenario();
        const producto = await productoDeBase(c.dueno, m.empresa, { clase: "INSUMO" });
        const articulo = valorDe(
          await c.casos.controlarArticulo(m.gerente, { productoId: producto }),
        ).articuloId;
        const vendible = await productoDeBase(c.dueno, m.empresa, { clase: "VENDIBLE" });
        const dejar = () =>
          firme(() => c.casos.dejarDeControlar(m.gerente, { productoId: producto }));
        const componer = () =>
          firme(() =>
            c.entorno.ejecutar({ contexto: m.gerente }, async (tx) => {
              await tx.articulosDeStock.obtener(m.empresaId, articulo);
              await c.esperarBarrera();
              return {
                ok: true as const,
                valor: await tx.composicionesDeStock.insertarVersion(m.empresaId, {
                  productoId: vendible,
                  numero: 1,
                  rinde: "1",
                  creadaPor: m.personaDelGerente,
                  creadaEn: m.gerente.ahora,
                  componentes: [
                    {
                      articuloId: articulo,
                      cantidad: "2",
                      unidadId: "UNIDAD",
                      dimension: "CONTEO",
                    },
                  ],
                }),
              };
            }),
          );
        const resultados = await aLaVez<{ ok: boolean; error?: unknown }>([dejar, componer], ronda);
        expect(
          resultados.filter((r) => r.ok).length,
          JSON.stringify(resultados),
        ).toBeGreaterThanOrEqual(1);
        const { rows } = await c.dueno.query(
          `select 1 from articulo_de_stock a
            where a.id = $1 and not a.activo
              and exists (select 1 from componente_de_composicion k where k.articulo_id = a.id)`,
          [articulo],
        );
        expect(rows).toHaveLength(0);
      }
    });
  });
});

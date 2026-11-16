import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  agregarElDeposito,
  listarLosDepositos,
  type DependenciasDeDepositosWeb,
} from "../../src/composicion/depositos-web";
import {
  aLaVez,
  firme,
  montarStock,
  nombreDeDeposito,
  nuevoId,
  RONDAS,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * «Depósitos» de stock de la web contra una base real y los roles reales: lo que la pantalla recibe, cada error con su código público, que repetir no duplica, que dos a la vez no se
 * pisan (el mismo nombre, dos «de venta»), que una sucursal ajena sale como el genérico y que el permiso lo decide el caso de uso. Los casos de uso en sí (guard, auditoría, concurrencia del
 * dominio) tienen sus pruebas en `stock-depositos.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("depósitos de stock de la web", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let d: DependenciasDeDepositosWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    d = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: () => undefined },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
    r.ok ? "OK" : (r.error?.codigo ?? "?");
  const alta = (
    quien = e.gerente,
    sucursal: string = e.sucursal,
    extra: Record<string, unknown> = {},
  ) =>
    agregarElDeposito(d, quien, sucursal, {
      id: nuevoId(),
      nombre: nombreDeDeposito(),
      uso: "NORMAL",
      ...extra,
    });
  const lista = async (quien = e.gerente, sucursal: string = e.sucursal) => {
    const r = await listarLosDepositos(d, quien, sucursal);
    if (!r.ok) throw new Error(`se esperaba la lista y vino ${r.error.codigo}`);
    return r.dato.depositos;
  };
  const sucursalNueva = async (): Promise<string> =>
    (
      await c.dueno.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
        [e.empresa, nombreDeDeposito("Sucursal")],
      )
    ).rows[0]?.id as string;
  const contar = (id: string) => c.contar("select count(*) as n from deposito where id = $1", [id]);
  const auditados = async (id: string) =>
    (await c.auditoria(e.empresa, "DEPOSITO_CREADO")).filter((r) => r["entidad_id"] === id).length;

  it("agregar con «de venta» deja el depósito en la lista de esa sucursal, con lo que la pantalla muestra y nada más", async () => {
    const sucursal = await sucursalNueva();
    const nombre = nombreDeDeposito("Salon");
    const r = await agregarElDeposito(d, e.gerente, sucursal, {
      id: nuevoId(),
      nombre,
      uso: "NORMAL",
      deVenta: true,
    });
    expect(r.ok).toBe(true);
    expect(await lista(e.gerente, sucursal)).toEqual([
      { id: r.ok ? r.dato.depositoId : "", nombre, uso: "NORMAL", deVenta: true, activo: true },
    ]);
    // La otra sucursal no lo ve.
    expect((await lista()).some((x) => x.nombre === nombre)).toBe(false);
  });

  it("sin «de venta» en el pedido, el depósito no es el de venta", async () => {
    const r = await alta(e.gerente, await sucursalNueva());
    expect(r.ok).toBe(true);
    const deposito = (await lista(e.gerente)).find((x) => r.ok && x.id === r.dato.depositoId);
    expect(deposito).toBeUndefined();
    expect(
      (
        await c.filas("select de_venta from deposito where id = $1", [
          r.ok ? r.dato.depositoId : "",
        ])
      )[0],
    ).toMatchObject({ de_venta: false });
  });

  describe("idempotencia", () => {
    it("repetir el mismo pedido devuelve el mismo depósito: una sola fila y una sola auditoría", async () => {
      const sucursal = await sucursalNueva();
      const pedido = { id: nuevoId(), nombre: nombreDeDeposito(), uso: "NORMAL", deVenta: false };
      const primera = await agregarElDeposito(d, e.gerente, sucursal, pedido);
      const segunda = await agregarElDeposito(d, e.gerente, sucursal, pedido);
      expect(primera).toEqual({ ok: true, dato: { depositoId: pedido.id } });
      expect(segunda).toEqual(primera);
      expect(await contar(pedido.id)).toBe(1);
      expect(await auditados(pedido.id)).toBe(1);
    });

    it("el mismo identificador con otro contenido es el genérico y no cambia lo guardado", async () => {
      const sucursal = await sucursalNueva();
      const id = nuevoId();
      const nombre = nombreDeDeposito();
      await agregarElDeposito(d, e.gerente, sucursal, { id, nombre, uso: "NORMAL" });
      const otro = await agregarElDeposito(d, e.gerente, sucursal, {
        id,
        nombre: nombreDeDeposito("Otro"),
        uso: "NORMAL",
      });
      expect(codigoDe(otro)).toBe("STOCK_ACCION_NO_PERMITIDA");
      expect((await lista(e.gerente, sucursal)).map((x) => x.nombre)).toEqual([nombre]);
    });

    it.each(Array.from({ length: RONDAS }, (_, i) => i))(
      "doble clic: dos envíos simultáneos con el mismo identificador crean UN depósito (ronda %i)",
      async (ronda) => {
        const sucursal = await sucursalNueva();
        const pedido = { id: nuevoId(), nombre: nombreDeDeposito(), uso: "NORMAL" };
        const resultados = await aLaVez(
          c,
          [
            () => firme(() => agregarElDeposito(d, e.gerente, sucursal, pedido)),
            () => firme(() => agregarElDeposito(d, e.gerente, sucursal, pedido)),
          ],
          ronda,
        );
        expect(resultados.map(codigoDe)).toEqual(["OK", "OK"]);
        expect(await contar(pedido.id)).toBe(1);
        expect(await auditados(pedido.id)).toBe(1);
      },
    );
  });

  describe("concurrencia", () => {
    it.each(Array.from({ length: RONDAS }, (_, i) => i))(
      "dos altas simultáneas con el mismo nombre (también con otras mayúsculas): una entra y la otra dice «ya existe» (ronda %i)",
      async (ronda) => {
        const sucursal = await sucursalNueva();
        const nombre = nombreDeDeposito("Cafe");
        const resultados = await aLaVez(
          c,
          [
            () =>
              firme(() =>
                agregarElDeposito(d, e.gerente, sucursal, { id: nuevoId(), nombre, uso: "NORMAL" }),
              ),
            () =>
              firme(() =>
                agregarElDeposito(d, e.gerente, sucursal, {
                  id: nuevoId(),
                  nombre: nombre.toUpperCase(),
                  uso: "NORMAL",
                }),
              ),
          ],
          ronda,
        );
        expect(resultados.map(codigoDe).sort()).toEqual(["OK", "STOCK_NOMBRE_DUPLICADO"]);
        expect(await lista(e.gerente, sucursal)).toHaveLength(1);
      },
    );

    it.each(Array.from({ length: RONDAS }, (_, i) => i))(
      "dos depósitos «de venta» a la vez en la misma sucursal: uno entra y el otro sale como el genérico (ronda %i)",
      async (ronda) => {
        const sucursal = await sucursalNueva();
        const resultados = await aLaVez(
          c,
          [1, 2].map(
            () => () =>
              firme(() =>
                agregarElDeposito(d, e.gerente, sucursal, {
                  id: nuevoId(),
                  nombre: nombreDeDeposito(),
                  uso: "NORMAL",
                  deVenta: true,
                }),
              ),
          ),
          ronda,
        );
        expect(resultados.map(codigoDe).sort()).toEqual(["OK", "STOCK_ACCION_NO_PERMITIDA"]);
        expect((await lista(e.gerente, sucursal)).filter((x) => x.deVenta)).toHaveLength(1);
      },
    );
  });

  describe("lo que el servidor rechaza", () => {
    it("un nombre repetido en la sucursal dice «ya existe»; el mismo nombre en otra sucursal es otro depósito", async () => {
      const sucursal = await sucursalNueva();
      const nombre = nombreDeDeposito();
      expect(codigoDe(await alta(e.gerente, sucursal, { nombre }))).toBe("OK");
      const repetida = await alta(e.gerente, sucursal, { nombre });
      expect(codigoDe(repetida)).toBe("STOCK_NOMBRE_DUPLICADO");
      expect(repetida.ok ? "" : repetida.error.clave).toBe("stock.error.nombre_duplicado");
      expect(codigoDe(await alta(e.gerente, await sucursalNueva(), { nombre }))).toBe("OK");
    });

    it.each(["CUARENTENA", "RECHAZO"])(
      "«de venta» con el uso %s es el genérico y no guarda nada",
      async (uso) => {
        const sucursal = await sucursalNueva();
        expect(codigoDe(await alta(e.gerente, sucursal, { uso, deVenta: true }))).toBe(
          "STOCK_ACCION_NO_PERMITIDA",
        );
        expect(await lista(e.gerente, sucursal)).toEqual([]);
      },
    );

    it.each([
      ["un uso que no existe", { uso: "INVENTADO" }],
      ["sin uso", { uso: undefined }],
      ["un identificador que no es uno", { id: "no-es-un-uuid" }],
      ["un nombre en blanco", { nombre: "   " }],
      ["un nombre que no es texto", { nombre: 7 }],
      ["«de venta» que no es un sí o no", { deVenta: "si" }],
    ])("%s es el genérico y no guarda nada", async (_caso, extra) => {
      const sucursal = await sucursalNueva();
      expect(codigoDe(await alta(e.gerente, sucursal, extra))).toBe("STOCK_ACCION_NO_PERMITIDA");
      expect(await lista(e.gerente, sucursal)).toEqual([]);
    });

    it("lo que no está en el esquema (empresa, sucursal, activo) se ignora: la sucursal es la del servidor", async () => {
      const sucursal = await sucursalNueva();
      const r = await agregarElDeposito(d, e.gerente, sucursal, {
        id: nuevoId(),
        nombre: nombreDeDeposito(),
        uso: "NORMAL",
        sucursalId: e.otraSucursal,
        empresaId: "00000000-0000-4000-8000-000000000000",
        activo: false,
      });
      expect(codigoDe(r)).toBe("OK");
      expect(await lista(e.gerente, sucursal)).toHaveLength(1);
    });
  });

  describe("permisos y aislamiento", () => {
    it("quien opera ve la lista pero no puede agregar: SIN_PERMISO, y no se escribe nada", async () => {
      const antes = await lista(e.operador);
      expect(codigoDe(await alta(e.operador))).toBe("SIN_PERMISO");
      expect(await lista(e.operador)).toEqual(antes);
    });

    it("el administrador de una sola sucursal no agrega en otra: el genérico", async () => {
      const r = await alta(e.administradorDeUnaSucursal, e.otraSucursal);
      expect(codigoDe(r)).toBe("STOCK_ACCION_NO_PERMITIDA");
    });

    it("una sucursal que no existe, o que es de otra empresa, es el genérico (sin pistas)", async () => {
      const b = await c.escenario();
      expect(codigoDe(await alta(e.gerente, nuevoId()))).toBe("STOCK_ACCION_NO_PERMITIDA");
      expect(codigoDe(await alta(e.gerente, b.sucursal))).toBe("STOCK_ACCION_NO_PERMITIDA");
    });

    it("la empresa B no ve los depósitos de la A, aunque pida la sucursal de la A", async () => {
      const b = await c.escenario();
      const sucursal = await sucursalNueva();
      await alta(e.gerente, sucursal);
      expect(await lista(b.gerente, sucursal)).toEqual([]);
    });

    it("con el módulo apagado nada se lee ni se escribe: MODULO_NO_ACTIVO", async () => {
      c.apagarModulo("stock");
      try {
        expect(codigoDe(await alta())).toBe("MODULO_NO_ACTIVO");
        const r = await listarLosDepositos(d, e.gerente, e.sucursal);
        expect(codigoDe(r)).toBe("MODULO_NO_ACTIVO");
      } finally {
        c.encenderModulos();
      }
    });
  });
});

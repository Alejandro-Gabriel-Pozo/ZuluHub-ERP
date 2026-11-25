import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { productoDeBase } from "./catalogo-apoyo";
import {
  agregarElDeposito,
  cambiarElEstadoDelDeposito,
  editarElDeposito,
  listarLosDepositos,
  verElDeposito,
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
      {
        id: r.ok ? r.dato.depositoId : "",
        nombre,
        uso: "NORMAL",
        deVenta: true,
        activo: true,
        version: 1,
      },
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

  // ===============================================================================================
  // STK-A: editar, desactivar y reactivar (maqueta `stock-depositos-gestion.html`, 25/11/2026).
  describe("editar", () => {
    const crear = async (extra: Record<string, unknown> = {}, sucursal: string = e.sucursal) => {
      const r = await alta(e.gerente, sucursal, extra);
      if (!r.ok) throw new Error(`no se pudo crear: ${r.error.codigo}`);
      return r.dato.depositoId;
    };
    const vigente = async (id: string, sucursal: string = e.sucursal) => {
      const r = await verElDeposito(d, e.gerente, sucursal, id);
      if (!r.ok) throw new Error(`se esperaba el depósito y vino ${r.error.codigo}`);
      return r.dato;
    };
    const editar = (
      id: string,
      version: number,
      extra: Record<string, unknown> = {},
      quien = e.gerente,
    ) =>
      editarElDeposito(d, quien, {
        depositoId: id,
        nombre: nombreDeDeposito("Renombrado"),
        deVenta: false,
        versionEsperada: version,
        ...extra,
      });
    const auditadosDe = async (accion: string, id: string) =>
      (await c.auditoria(e.empresa, accion)).filter((r) => r["entidad_id"] === id).length;

    it("cambia el nombre, sube la versión y audita solo lo que cambió", async () => {
      const sucursal = await sucursalNueva();
      const id = await crear({}, sucursal);
      const nombre = nombreDeDeposito("Nuevo");
      const r = await editar(id, 1, { nombre });
      expect(r).toEqual({ ok: true, dato: { version: 2, yaEstaba: false } });
      expect(await vigente(id, sucursal)).toMatchObject({ nombre, version: 2, deVenta: false });
      const registro = (await c.auditoria(e.empresa, "DEPOSITO_EDITADO")).find(
        (x) => x["entidad_id"] === id,
      );
      expect(registro?.["despues"]).toEqual({ nombre });
      expect(registro?.["actor_persona_id"]).toBe(e.personaDelGerente);
    });

    it("«de venta» se puede marcar en un depósito Normal y no en uno de Cuarentena (el genérico, sin guardar nada)", async () => {
      const sucursal = await sucursalNueva();
      const normal = await crear({}, sucursal);
      expect(codigoDe(await editar(normal, 1, { deVenta: true }))).toBe("OK");
      expect((await vigente(normal, sucursal)).deVenta).toBe(true);
      const cuarentena = await crear({ uso: "CUARENTENA" }, sucursal);
      const rechazo = await editar(cuarentena, 1, { deVenta: true });
      expect(codigoDe(rechazo)).toBe("STOCK_ACCION_NO_PERMITIDA");
      expect(await vigente(cuarentena, sucursal)).toMatchObject({ deVenta: false, version: 1 });
    });

    it("un nombre repetido en la sucursal dice «ya existe» y no cambia nada", async () => {
      const sucursal = await sucursalNueva();
      const nombre = nombreDeDeposito("Repetido");
      await crear({ nombre }, sucursal);
      const id = await crear({}, sucursal);
      const antes = await vigente(id, sucursal);
      const r = await editar(id, 1, { nombre: nombre.toUpperCase() });
      expect(codigoDe(r)).toBe("STOCK_NOMBRE_DUPLICADO");
      expect(await vigente(id, sucursal)).toEqual(antes);
    });

    it("con una versión vieja: «otra persona lo modificó», y no pisa lo de la otra persona", async () => {
      const sucursal = await sucursalNueva();
      const id = await crear({}, sucursal);
      const primero = nombreDeDeposito("Primero");
      expect(codigoDe(await editar(id, 1, { nombre: primero }))).toBe("OK");
      const tarde = await editar(id, 1, { nombre: nombreDeDeposito("Tarde") });
      expect(codigoDe(tarde)).toBe("STOCK_DEPOSITO_DESACTUALIZADO");
      expect(tarde.ok ? "" : tarde.error.clave).toBe("stock.error.deposito_desactualizado");
      expect(await vigente(id, sucursal)).toMatchObject({ nombre: primero, version: 2 });
    });

    it("repetir una edición ya aplicada devuelve lo vigente (aunque la versión sea vieja), sin escribir ni auditar de nuevo", async () => {
      const sucursal = await sucursalNueva();
      const id = await crear({}, sucursal);
      const nombre = nombreDeDeposito("Igual");
      expect(await editar(id, 1, { nombre })).toEqual({
        ok: true,
        dato: { version: 2, yaEstaba: false },
      });
      const repetida = await editar(id, 1, { nombre });
      expect(repetida).toEqual({ ok: true, dato: { version: 2, yaEstaba: true } });
      expect(await auditadosDe("DEPOSITO_EDITADO", id)).toBe(1);
      expect((await vigente(id, sucursal)).version).toBe(2);
    });

    it.each(Array.from({ length: RONDAS }, (_, i) => i))(
      "doble clic: dos «Guardar» a la vez con lo mismo cambian UNA vez y se auditan UNA vez (ronda %i)",
      async (ronda) => {
        const sucursal = await sucursalNueva();
        const id = await crear({}, sucursal);
        const nombre = nombreDeDeposito("Doble");
        const resultados = await aLaVez(
          c,
          [
            () => firme(() => editar(id, 1, { nombre })),
            () => firme(() => editar(id, 1, { nombre })),
          ],
          ronda,
        );
        expect(resultados.map(codigoDe)).toEqual(["OK", "OK"]);
        expect(await auditadosDe("DEPOSITO_EDITADO", id)).toBe(1);
        expect(await vigente(id, sucursal)).toMatchObject({ nombre, version: 2 });
      },
    );

    it.each(Array.from({ length: RONDAS }, (_, i) => i))(
      "dos pestañas editan el mismo depósito a la vez con nombres distintos: una gana y la otra recibe «otra persona lo modificó» (ronda %i)",
      async (ronda) => {
        const sucursal = await sucursalNueva();
        const id = await crear({}, sucursal);
        const a = nombreDeDeposito("PestanaA");
        const b = nombreDeDeposito("PestanaB");
        const resultados = await aLaVez(
          c,
          [
            () => firme(() => editar(id, 1, { nombre: a })),
            () => firme(() => editar(id, 1, { nombre: b })),
          ],
          ronda,
        );
        expect(resultados.map(codigoDe).sort()).toEqual(["OK", "STOCK_DEPOSITO_DESACTUALIZADO"]);
        const final = await vigente(id, sucursal);
        expect([a, b]).toContain(final.nombre);
        expect(final.version).toBe(2);
        expect(await auditadosDe("DEPOSITO_EDITADO", id)).toBe(1);
      },
    );

    it("dos depósitos que se renombran a la vez al MISMO nombre: uno entra y el otro dice «ya existe»", async () => {
      const sucursal = await sucursalNueva();
      const uno = await crear({}, sucursal);
      const otro = await crear({}, sucursal);
      const nombre = nombreDeDeposito("Mismo");
      const resultados = await aLaVez(
        c,
        [
          () => firme(() => editar(uno, 1, { nombre })),
          () => firme(() => editar(otro, 1, { nombre })),
        ],
        0,
      );
      expect(resultados.map(codigoDe).sort()).toEqual(["OK", "STOCK_NOMBRE_DUPLICADO"]);
    });

    it.each([
      ["un identificador que no es uno", { depositoId: "no-es-un-uuid" }],
      ["un nombre que no es texto", { nombre: 7 }],
      ["una versión negativa", { versionEsperada: -1 }],
      ["una versión con decimales", { versionEsperada: "1.5" }],
      ["«de venta» que no es un sí o no", { deVenta: "si" }],
    ])("%s es el genérico y no cambia nada", async (_caso, extra) => {
      const sucursal = await sucursalNueva();
      const id = await crear({}, sucursal);
      const antes = await vigente(id, sucursal);
      expect(codigoDe(await editar(id, 1, extra))).toBe("STOCK_ACCION_NO_PERMITIDA");
      expect(await vigente(id, sucursal)).toEqual(antes);
    });

    it("un nombre en blanco o con un carácter que el catálogo no permite es el genérico y no cambia nada", async () => {
      const sucursal = await sucursalNueva();
      const id = await crear({}, sucursal);
      const antes = await vigente(id, sucursal);
      for (const nombre of ["   ", "uno\ndos", "<b>x</b>"]) {
        expect(codigoDe(await editar(id, 1, { nombre }))).toBe("STOCK_ACCION_NO_PERMITIDA");
      }
      expect(await vigente(id, sucursal)).toEqual(antes);
    });

    it("lo que no está en el esquema (el uso, la sucursal, la empresa) se ignora: el uso no cambia", async () => {
      const sucursal = await sucursalNueva();
      const id = await crear({}, sucursal);
      const r = await editar(id, 1, {
        uso: "RECHAZO",
        sucursalId: e.otraSucursal,
        empresaId: "00000000-0000-4000-8000-000000000000",
      });
      expect(codigoDe(r)).toBe("OK");
      expect(await vigente(id, sucursal)).toMatchObject({ uso: "NORMAL" });
      expect(
        (await c.filas("select sucursal_id from deposito where id = $1", [id]))[0],
      ).toMatchObject({ sucursal_id: sucursal });
    });

    it("quien opera no edita: SIN_PERMISO, y no se escribe nada", async () => {
      const sucursal = await sucursalNueva();
      const id = await crear({}, sucursal);
      const antes = await vigente(id, sucursal);
      expect(codigoDe(await editar(id, 1, {}, e.operador))).toBe("SIN_PERMISO");
      expect(await vigente(id, sucursal)).toEqual(antes);
    });

    it("el administrador de una sola sucursal no edita un depósito de otra: el genérico, sin guardar", async () => {
      const id = await crear({}, e.otraSucursal);
      const antes = await vigente(id, e.otraSucursal);
      const r = await editar(id, 1, {}, e.administradorDeUnaSucursal);
      expect(codigoDe(r)).toBe("STOCK_ACCION_NO_PERMITIDA");
      expect(await vigente(id, e.otraSucursal)).toEqual(antes);
    });

    it("la empresa B no ve ni edita un depósito de la A (indistinguible de «no existe»)", async () => {
      const b = await c.escenario();
      const sucursal = await sucursalNueva();
      const id = await crear({}, sucursal);
      const antes = await vigente(id, sucursal);
      expect(codigoDe(await verElDeposito(d, b.gerente, sucursal, id))).toBe(
        "STOCK_ACCION_NO_PERMITIDA",
      );
      expect(codigoDe(await editar(id, 1, {}, b.gerente))).toBe("STOCK_ACCION_NO_PERMITIDA");
      expect(await vigente(id, sucursal)).toEqual(antes);
    });

    it("el depósito de otra sucursal que la elegida no se puede abrir para editar: el genérico", async () => {
      const id = await crear({}, e.otraSucursal);
      expect(codigoDe(await verElDeposito(d, e.gerente, e.sucursal, id))).toBe(
        "STOCK_ACCION_NO_PERMITIDA",
      );
    });

    it("con el módulo apagado no se lee ni se edita: MODULO_NO_ACTIVO", async () => {
      const sucursal = await sucursalNueva();
      const id = await crear({}, sucursal);
      c.apagarModulo("stock");
      try {
        expect(codigoDe(await editar(id, 1))).toBe("MODULO_NO_ACTIVO");
        expect(codigoDe(await verElDeposito(d, e.gerente, sucursal, id))).toBe("MODULO_NO_ACTIVO");
      } finally {
        c.encenderModulos();
      }
    });
  });

  describe("desactivar y reactivar", () => {
    const crear = async (extra: Record<string, unknown> = {}, sucursal: string = e.sucursal) => {
      const r = await alta(e.gerente, sucursal, extra);
      if (!r.ok) throw new Error(`no se pudo crear: ${r.error.codigo}`);
      return r.dato.depositoId;
    };
    const cambiar = (id: string, activo: boolean, quien = e.gerente) =>
      cambiarElEstadoDelDeposito(d, quien, { depositoId: id }, activo);
    const activo = async (id: string) =>
      (await c.filas("select activo from deposito where id = $1", [id]))[0]?.["activo"];
    const auditadosDe = async (accion: string, id: string) =>
      (await c.auditoria(e.empresa, accion)).filter((r) => r["entidad_id"] === id).length;

    it("desactiva, el depósito sigue en la lista con su estado, y se puede reactivar; cada paso queda auditado una vez", async () => {
      const sucursal = await sucursalNueva();
      const id = await crear({}, sucursal);
      expect(await cambiar(id, false)).toEqual({ ok: true, dato: { yaEstaba: false } });
      expect((await lista(e.gerente, sucursal)).find((x) => x.id === id)?.activo).toBe(false);
      expect(await cambiar(id, true)).toEqual({ ok: true, dato: { yaEstaba: false } });
      expect((await lista(e.gerente, sucursal)).find((x) => x.id === id)?.activo).toBe(true);
      expect(await auditadosDe("DEPOSITO_DESACTIVADO", id)).toBe(1);
      expect(await auditadosDe("DEPOSITO_REACTIVADO", id)).toBe(1);
    });

    it("repetir lo ya hecho es éxito y no escribe ni audita de nuevo", async () => {
      const id = await crear({}, await sucursalNueva());
      await cambiar(id, false);
      expect(await cambiar(id, false)).toEqual({ ok: true, dato: { yaEstaba: true } });
      expect(await auditadosDe("DEPOSITO_DESACTIVADO", id)).toBe(1);
      expect(await cambiar(id, true)).toEqual({ ok: true, dato: { yaEstaba: false } });
      expect(await cambiar(id, true)).toEqual({ ok: true, dato: { yaEstaba: true } });
      expect(await auditadosDe("DEPOSITO_REACTIVADO", id)).toBe(1);
    });

    it.each(Array.from({ length: RONDAS }, (_, i) => i))(
      "doble clic en «Desactivar»: dos pedidos a la vez desactivan UNA vez y auditan UNA vez (ronda %i)",
      async (ronda) => {
        const id = await crear({}, await sucursalNueva());
        const resultados = await aLaVez(
          c,
          [() => firme(() => cambiar(id, false)), () => firme(() => cambiar(id, false))],
          ronda,
        );
        expect(resultados.map(codigoDe)).toEqual(["OK", "OK"]);
        expect(await activo(id)).toBe(false);
        expect(await auditadosDe("DEPOSITO_DESACTIVADO", id)).toBe(1);
      },
    );

    it("desactivar el «de venta» dice «no se puede desactivar el depósito de venta» y no cambia nada", async () => {
      const id = await crear({ deVenta: true }, await sucursalNueva());
      const r = await cambiar(id, false);
      expect(codigoDe(r)).toBe("STOCK_ES_EL_DE_VENTA");
      expect(r.ok ? "" : r.error.clave).toBe("stock.error.es_el_de_venta");
      expect(await activo(id)).toBe(true);
      expect(await auditadosDe("DEPOSITO_DESACTIVADO", id)).toBe(0);
    });

    it("desactivar uno con existencia dice «el depósito tiene existencia» y no cambia nada", async () => {
      const id = await crear({}, await sucursalNueva());
      const producto = await productoDeBase(c.dueno, e.empresa, { clase: "INSUMO" });
      const articulo = await c.casos.controlarArticulo(e.gerente, { productoId: producto });
      if (!articulo.ok) throw new Error("no se pudo controlar el artículo");
      const entrada = await c.entrar(e.gerente, {
        depositoId: id,
        articuloId: articulo.valor.articuloId,
        cantidad: "2",
      });
      expect(entrada.ok).toBe(true);
      const r = await cambiar(id, false);
      expect(codigoDe(r)).toBe("STOCK_DEPOSITO_CON_EXISTENCIA");
      expect(r.ok ? "" : r.error.clave).toBe("stock.error.deposito_con_existencia");
      expect(await activo(id)).toBe(true);
    });

    it("desactivar uno con un conteo abierto dice «ya hay un conteo abierto en este depósito» (el texto de conteo, reutilizado)", async () => {
      const id = await crear({}, await sucursalNueva());
      await c.dueno.query(
        "insert into conteo_fisico (id, empresa_id, deposito_id, abierto_por, abierto_en) values ($1, $2, $3, $4, now())",
        [nuevoId(), e.empresa, id, e.personaDelGerente],
      );
      const r = await cambiar(id, false);
      expect(codigoDe(r)).toBe("STOCK_CONTEO_EN_CURSO");
      expect(r.ok ? "" : r.error.clave).toBe("stock.error.conteo_en_curso");
      expect(await activo(id)).toBe(true);
    });

    it.each(Array.from({ length: RONDAS }, (_, i) => i))(
      "desactivar mientras otra sesión le entra mercadería: o entra la mercadería y no se desactiva, o se desactiva y la entrada es rechazada; nunca las dos (ronda %i)",
      async (ronda) => {
        const id = await crear({}, await sucursalNueva());
        const producto = await productoDeBase(c.dueno, e.empresa, { clase: "INSUMO" });
        const articulo = await c.casos.controlarArticulo(e.gerente, { productoId: producto });
        if (!articulo.ok) throw new Error("no se pudo controlar el artículo");
        const resultados = await aLaVez(
          c,
          [
            () => firme(async () => ({ ok: (await cambiar(id, false)).ok })),
            () =>
              firme(async () => ({
                ok: (
                  await c.entrar(e.gerente, {
                    depositoId: id,
                    articuloId: articulo.valor.articuloId,
                    cantidad: "2",
                  })
                ).ok,
              })),
          ],
          ronda,
        );
        const existencia = await c.contar(
          "select count(*) as n from saldo_de_stock where deposito_id = $1 and existencia <> 0",
          [id],
        );
        const desactivado = (await activo(id)) === false;
        expect(desactivado && existencia > 0).toBe(false);
        expect(resultados.some((r) => r.ok)).toBe(true);
      },
    );

    it("quien opera no desactiva ni reactiva: SIN_PERMISO, y no cambia nada", async () => {
      const id = await crear({}, await sucursalNueva());
      expect(codigoDe(await cambiar(id, false, e.operador))).toBe("SIN_PERMISO");
      expect(await activo(id)).toBe(true);
      await cambiar(id, false);
      expect(codigoDe(await cambiar(id, true, e.operador))).toBe("SIN_PERMISO");
      expect(await activo(id)).toBe(false);
    });

    it("el administrador de una sola sucursal no desactiva uno de otra: el genérico", async () => {
      const id = await crear({}, e.otraSucursal);
      const r = await cambiar(id, false, e.administradorDeUnaSucursal);
      expect(codigoDe(r)).toBe("STOCK_ACCION_NO_PERMITIDA");
      expect(await activo(id)).toBe(true);
    });

    it("la empresa B no desactiva uno de la A, y un identificador que no es uno es el genérico", async () => {
      const b = await c.escenario();
      const id = await crear({}, await sucursalNueva());
      expect(codigoDe(await cambiar(id, false, b.gerente))).toBe("STOCK_ACCION_NO_PERMITIDA");
      expect(await activo(id)).toBe(true);
      expect(
        codigoDe(await cambiarElEstadoDelDeposito(d, e.gerente, { depositoId: "x" }, false)),
      ).toBe("STOCK_ACCION_NO_PERMITIDA");
      expect(
        codigoDe(await cambiarElEstadoDelDeposito(d, e.gerente, { depositoId: nuevoId() }, false)),
      ).toBe("STOCK_ACCION_NO_PERMITIDA");
    });
  });
});

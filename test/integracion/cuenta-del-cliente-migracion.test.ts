import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { comoEmpresa, crearBaseAparte } from "./entorno";
import { HUELLA, claveNueva } from "./caja-apoyo";
import {
  acepta,
  check,
  clave,
  conAppDe,
  denegado,
  filas,
  referencia,
  type Mundo,
  crearMundo,
} from "./fiscal-apoyo";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import { SesionDePrueba, esperarBloqueo, type Intento } from "./sesiones";
import { cuitUnico, sufijoUnico } from "./unicos";

/**
 * Migración CC-1 (0106): la ficha de habilitación del cliente a deber y las clases A_COBRAR del libro. SQL directo con el rol de la aplicación sobre
 * una base propia con todas las migraciones (RLS forzada, GRANT por columna). Previene: dos fichas para el mismo cliente, una ficha sobre una parte
 * que no es cliente, está inactiva, está anonimizada o no tiene CUIT, una ficha vista o escrita desde otra empresa, cambiar lo que identifica a la
 * ficha, borrar una ficha, y una migración que toca lo que ya existía o falla al correrse otra vez.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const MIGRACION = "0106_cuenta_del_cliente.sql";
const REVERSION = "reversiones/0106_revertir_cuenta_del_cliente.sql";

describe("migración 0106: cuenta del cliente", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let m: Mundo;
  let otra: Mundo;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    m = await crearMundo(dueno);
    otra = await crearMundo(dueno);
  });
  afterAll(async () => {
    if (base === null) return;
    await dueno.end();
    await propia.destruir();
  });

  const b = () => propia.base;

  /** Rechazada por la RLS (42501) o por la parte que la sesión no ve (23503): el disparador corre antes que la política de alta, y las dos cierran. */
  const rechazada = (r: Intento) => {
    expect(r.ok, "tenía que rechazarse").toBe(false);
    if (!r.ok) expect(["42501", "23503"], r.mensaje).toContain(r.codigo);
  };

  type OpcionesDeParte = Partial<{
    estado: "ACTIVA" | "INACTIVA" | "ANONIMIZADA";
    rol: string | null;
    documento: "CUIT" | "DNI" | null;
    rolActivo: boolean;
    naturaleza: "HUMANA" | "JURIDICA";
  }>;

  /** Una parte con rol, documento y estado a elección (por defecto: cliente activo con CUIT). */
  const crearParte = async (mundo: Mundo = m, o: OpcionesDeParte = {}): Promise<string> => {
    const id = randomUUID();
    const documento = o.documento === undefined ? "CUIT" : o.documento;
    await dueno.query(
      `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
       values ($1, $2, gen_random_uuid(), $3, $4, $5, $6, $7)`,
      [
        id,
        mundo.empresa,
        o.naturaleza ?? "JURIDICA",
        `Cliente ${sufijoUnico()}`,
        documento,
        documento === "CUIT" ? cuitUnico() : documento === "DNI" ? "20123456" : null,
        mundo.persona,
      ],
    );
    const rol = o.rol === undefined ? "CUSTOMER" : o.rol;
    if (rol !== null) {
      await dueno.query(
        "insert into parte_rol (empresa_id, parte_id, rol, activo) values ($1, $2, $3, $4)",
        [mundo.empresa, id, rol, o.rolActivo ?? true],
      );
    }
    if (o.estado === "INACTIVA") {
      await dueno.query("update parte set estado = 'INACTIVA' where id = $1", [id]);
    } else if (o.estado === "ANONIMIZADA") {
      await dueno.query("update parte_rol set activo = false where parte_id = $1", [id]);
      await dueno.query(
        `update parte set estado = 'ANONIMIZADA', nombre = null, documento_tipo = null, documento_numero = null,
           anonimizada_en = now() where id = $1`,
        [id],
      );
    }
    return id;
  };

  const habilitar = (
    s: SesionDePrueba,
    parte: string,
    o: Partial<{
      plazo: number;
      limite: string;
      clave: string;
      mundo: Mundo;
      persona: string;
    }> = {},
  ) =>
    s.intentar(
      `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
       values ($1, $2, $3, $4, $5, $6, $7) returning id, estado, version, moneda`,
      [
        (o.mundo ?? m).empresa,
        parte,
        o.plazo ?? 30,
        o.limite ?? "100000.00",
        o.clave ?? claveNueva(),
        HUELLA,
        o.persona ?? (o.mundo ?? m).persona,
      ],
    );

  describe("alta de la ficha", () => {
    it("un cliente activo con CUIT queda habilitado, en ARS, con versión 1", async () => {
      if (base === null) return;
      const parte = await crearParte();
      await conAppDe(b(), m, async (s) => {
        const r = await habilitar(s, parte, { plazo: 60, limite: "250000.50" });
        acepta(r);
        if (r.ok) {
          expect(r.rows[0]).toMatchObject({ estado: "HABILITADA", version: 1, moneda: "ARS" });
        }
      });
    });

    it("una sola ficha por cliente y empresa, aunque las claves sean distintas", async () => {
      if (base === null) return;
      const parte = await crearParte();
      await conAppDe(b(), m, async (s) => {
        acepta(await habilitar(s, parte));
        clave(await habilitar(s, parte), "cuenta_cliente_parte_uk");
      });
    });

    it("la misma clave no duplica la ficha (restricción única por empresa y clave)", async () => {
      if (base === null) return;
      const a = await crearParte();
      const c = await crearParte();
      const k = claveNueva();
      await conAppDe(b(), m, async (s) => {
        acepta(await habilitar(s, a, { clave: k }));
        clave(await habilitar(s, c, { clave: k }), "cuenta_cliente_clave_uk");
      });
    });

    it.each([
      ["una parte inactiva", { estado: "INACTIVA" as const }, "cuenta_cliente_parte_no_activa"],
      ["una parte anonimizada", { estado: "ANONIMIZADA" as const }, "cuenta_cliente_parte_fkey"],
      ["una parte sin rol de cliente", { rol: null }, "cuenta_cliente_sin_rol_cliente"],
      [
        "una parte con otro rol (proveedor)",
        { rol: "PROVEEDOR" },
        "cuenta_cliente_sin_rol_cliente",
      ],
      ["un cliente con el rol apagado", { rolActivo: false }, "cuenta_cliente_sin_rol_cliente"],
      ["un cliente sin documento", { documento: null }, "cuenta_cliente_sin_cuit"],
      [
        "un cliente con DNI en vez de CUIT",
        { documento: "DNI" as const, naturaleza: "HUMANA" as const },
        "cuenta_cliente_sin_cuit",
      ],
    ] as const)("rechaza %s", async (_nombre, opciones, restriccion) => {
      if (base === null) return;
      const parte = await crearParte(m, opciones);
      await conAppDe(b(), m, async (s) => {
        const r = await habilitar(s, parte);
        if (restriccion.endsWith("_fkey")) referencia(r, restriccion);
        else check(r, restriccion);
      });
    });

    it("plazo 0 o 366, límite negativo, con más de 2 decimales o sobre el tope: rechazados", async () => {
      if (base === null) return;
      const parte = await crearParte();
      await conAppDe(b(), m, async (s) => {
        check(await habilitar(s, parte, { plazo: 0 }), "cuenta_cliente_plazo_ck");
        check(await habilitar(s, parte, { plazo: 366 }), "cuenta_cliente_plazo_ck");
        check(await habilitar(s, parte, { limite: "-1" }), "cuenta_cliente_limite_ck");
        check(await habilitar(s, parte, { limite: "1000000000" }), "cuenta_cliente_limite_ck");
        // Con más de 2 decimales numeric(18,2) redondea: la frontera (el esquema de entrada) es quien lo rechaza antes.
        acepta(await habilitar(s, parte, { plazo: 365, limite: "0" }));
      });
    });

    it("la clave y la huella tienen la forma de las del resto del repositorio", async () => {
      if (base === null) return;
      const parte = await crearParte();
      await conAppDe(b(), m, async (s) => {
        check(await habilitar(s, parte, { clave: "corta" }), "cuenta_cliente_clave_ck");
        const r = await s.intentar(
          `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
           values ($1, $2, 30, 1, $3, 'XYZ', $4)`,
          [m.empresa, parte, claveNueva(), m.persona],
        );
        check(r, "cuenta_cliente_huella_ck");
      });
    });
  });

  describe("aislamiento entre empresas", () => {
    it("la empresa B no ve la ficha de A ni puede habilitar una parte de A", async () => {
      if (base === null) return;
      const parteA = await crearParte(m);
      await conAppDe(b(), m, async (s) => acepta(await habilitar(s, parteA)));
      // La ficha de A está confirmada? (conAppDe deshace): se crea con el dueño para poder mirarla desde B.
      await dueno.query(
        `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
         values ($1, $2, 30, 10, $3, $4, $5)`,
        [m.empresa, parteA, claveNueva(), HUELLA, m.persona],
      );
      await conAppDe(b(), otra, async (s) => {
        const vistas = await s.intentar("select id from cuenta_del_cliente");
        filas(vistas, 0);
        // `parte_id` de otra empresa: la clave foránea compuesta lo rechaza (la parte no existe en la empresa B).
        referencia(await habilitar(s, parteA, { mundo: otra }), "cuenta_cliente_parte_fkey");
        // `empresa_id` ajeno: lo rechaza la política de alta.
        rechazada(await habilitar(s, parteA, { mundo: m, persona: otra.persona }));
      });
    });

    it("no se puede insertar a nombre de otra persona", async () => {
      if (base === null) return;
      const parte = await crearParte();
      await conAppDe(b(), m, async (s) => {
        denegado(await habilitar(s, parte, { persona: otra.persona }));
      });
    });
  });

  describe("cambios, suspensión y privilegios", () => {
    const fichaConfirmada = async (mundo: Mundo = m): Promise<{ id: string; parte: string }> => {
      const parte = await crearParte(mundo);
      const r = await dueno.query<{ id: string }>(
        `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
         values ($1, $2, 30, 1000, $3, $4, $5) returning id`,
        [mundo.empresa, parte, claveNueva(), HUELLA, mundo.persona],
      );
      return { id: r.rows[0]?.id as string, parte };
    };

    it("cambiar plazo y límite sube la versión; el estado y el motivo van juntos", async () => {
      if (base === null) return;
      const f = await fichaConfirmada();
      await conAppDe(b(), m, async (s) => {
        const r = await s.intentar(
          "update cuenta_del_cliente set plazo_dias = 60, limite = 5000.25 where id = $1 returning version, plazo_dias, limite::text as limite",
          [f.id],
        );
        acepta(r);
        if (r.ok)
          expect(r.rows[0]).toMatchObject({ version: 2, plazo_dias: 60, limite: "5000.25" });
        // Suspender exige motivo, y un motivo exige estar suspendida.
        check(
          await s.intentar("update cuenta_del_cliente set estado = 'SUSPENDIDA' where id = $1", [
            f.id,
          ]),
          "cuenta_cliente_suspension_ck",
        );
        check(
          await s.intentar(
            "update cuenta_del_cliente set motivo_de_suspension = 'Mora' where id = $1",
            [f.id],
          ),
          "cuenta_cliente_suspension_ck",
        );
        acepta(
          await s.intentar(
            "update cuenta_del_cliente set estado = 'SUSPENDIDA', motivo_de_suspension = 'Pagos vencidos' where id = $1",
            [f.id],
          ),
        );
        acepta(
          await s.intentar(
            "update cuenta_del_cliente set estado = 'HABILITADA', motivo_de_suspension = null where id = $1",
            [f.id],
          ),
        );
      });
    });

    it("reactivar vuelve a pedir que la parte pueda deber; suspender y cambiar condiciones no", async () => {
      if (base === null) return;
      const f = await fichaConfirmada();
      await dueno.query(
        "update cuenta_del_cliente set estado = 'SUSPENDIDA', motivo_de_suspension = 'Pagos vencidos' where id = $1",
        [f.id],
      );
      await dueno.query("update parte set estado = 'INACTIVA' where id = $1", [f.parte]);
      await conAppDe(b(), m, async (s) => {
        // Con la parte inactiva se puede cambiar el límite de una ficha suspendida...
        acepta(await s.intentar("update cuenta_del_cliente set limite = 10 where id = $1", [f.id]));
        // ...pero no reactivarla.
        check(
          await s.intentar(
            "update cuenta_del_cliente set estado = 'HABILITADA', motivo_de_suspension = null where id = $1",
            [f.id],
          ),
          "cuenta_cliente_parte_no_activa",
        );
      });
    });

    it("lo que identifica a la ficha no cambia (ni siquiera para el dueño de la base) y la aplicación no recibe esas columnas", async () => {
      if (base === null) return;
      const f = await fichaConfirmada();
      await conAppDe(b(), m, async (s) => {
        for (const columna of [
          "empresa_id",
          "parte_id",
          "clave_idempotencia",
          "huella",
          "habilitada_por",
          "habilitada_en",
          "moneda",
          "id",
          "version",
        ]) {
          denegado(
            await s.intentar(
              `update cuenta_del_cliente set ${columna} = ${columna} where id = $1`,
              [f.id],
            ),
          );
        }
      });
      await expect(
        dueno.query(
          "update cuenta_del_cliente set habilitada_en = now() - interval '1 day' where id = $1",
          [f.id],
        ),
      ).rejects.toMatchObject({ constraint: "cuenta_cliente_identidad_inmutable" });
      await expect(
        dueno.query("update cuenta_del_cliente set huella = $2 where id = $1", [
          f.id,
          "b".repeat(64),
        ]),
      ).rejects.toMatchObject({ constraint: "cuenta_cliente_identidad_inmutable" });
    });

    it("nadie borra ni vacía la ficha: la aplicación y el dueño reciben error", async () => {
      if (base === null) return;
      const f = await fichaConfirmada();
      await conAppDe(b(), m, async (s) => {
        denegado(await s.intentar("delete from cuenta_del_cliente where id = $1", [f.id]));
        denegado(await s.intentar("truncate cuenta_del_cliente"));
      });
      await expect(
        dueno.query("delete from cuenta_del_cliente where id = $1", [f.id]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(dueno.query("truncate cuenta_del_cliente")).rejects.toMatchObject({
        code: "42501",
      });
    });

    it("la empresa B no cambia la ficha de A (la actualización no encuentra la fila)", async () => {
      if (base === null) return;
      const f = await fichaConfirmada();
      await conAppDe(b(), otra, async (s) => {
        filas(
          await s.intentar("update cuenta_del_cliente set limite = 1 where id = $1", [f.id]),
          0,
        );
      });
    });

    it("una empresa suspendida no escribe fichas", async () => {
      if (base === null) return;
      const suspendida = await crearMundo(dueno, { estado: "SUSPENDED" });
      const parte = await crearParte(suspendida);
      await conAppDe(b(), suspendida, async (s) => {
        rechazada(await habilitar(s, parte, { mundo: suspendida }));
      });
    });
  });

  describe("concurrencia", () => {
    it("dos habilitaciones simultáneas de la misma parte (claves distintas): una gana, la otra recibe la restricción única", async () => {
      if (base === null) return;
      const parte = await crearParte();
      const abrir = () =>
        SesionDePrueba.abrir(
          b(),
          "pedernal_app",
          comoEmpresa(empresaId(m.empresa), personaId(m.persona)),
        );
      const [s1, s2] = await Promise.all([abrir(), abrir()]);
      try {
        acepta(await habilitar(s1, parte));
        // La segunda espera la confirmación de la primera (índice único) y falla al confirmarse.
        const segunda = habilitar(s2, parte);
        await new Promise((r) => setTimeout(r, 200));
        acepta(await s1.confirmar());
        const r = await segunda;
        clave(r, "cuenta_cliente_parte_uk");
      } finally {
        await s1.cerrar();
        await s2.cerrar();
      }
      const n = await dueno.query<{ n: number }>(
        "select count(*)::int as n from cuenta_del_cliente where parte_id = $1",
        [parte],
      );
      expect(n.rows[0]?.n).toBe(1);
    });

    /** Anonimiza como lo haría la baja de un cliente: apaga el rol y anonimiza la parte, en UNA transacción, desde otra conexión. */
    const anonimizarEnOtraConexion = async (parte: string) => {
      const otraConexion = new pg.Client({ connectionString: propia.base.dueno });
      await otraConexion.connect();
      await otraConexion.query("begin");
      await otraConexion.query("update parte_rol set activo = false where parte_id = $1", [parte]);
      const pid = (await otraConexion.query<{ pid: number }>("select pg_backend_pid() as pid"))
        .rows[0]?.pid as number;
      const anonimizar = otraConexion
        .query(
          `update parte set estado = 'ANONIMIZADA', nombre = null, documento_tipo = null, documento_numero = null, anonimizada_en = now() where id = $1`,
          [parte],
        )
        .then(() => otraConexion.query("commit"));
      return { otraConexion, pid, anonimizar };
    };

    it("anonimizar la parte primero y habilitar después: la habilitación es rechazada (la parte ya no existe para la aplicación) y no queda ficha", async () => {
      if (base === null) return;
      const parte = await crearParte();
      const { otraConexion, anonimizar } = await anonimizarEnOtraConexion(parte);
      try {
        await anonimizar;
        await conAppDe(b(), m, async (s) => {
          referencia(await habilitar(s, parte), "cuenta_cliente_parte_fkey");
        });
      } finally {
        await otraConexion.end();
      }
      const n = await dueno.query<{ n: number }>(
        "select count(*)::int as n from cuenta_del_cliente where parte_id = $1",
        [parte],
      );
      expect(n.rows[0]?.n).toBe(0);
    });

    it("habilitar primero y anonimizar después: la anonimización ESPERA a que la habilitación termine (la parte queda bloqueada con FOR SHARE), no se cruzan", async () => {
      if (base === null) return;
      const parte = await crearParte();
      const s = await SesionDePrueba.abrir(
        b(),
        "pedernal_app",
        comoEmpresa(empresaId(m.empresa), personaId(m.persona)),
      );
      let otraConexion: pg.Client | null = null;
      try {
        acepta(await habilitar(s, parte));
        const anonimizando = await anonimizarEnOtraConexion(parte);
        otraConexion = anonimizando.otraConexion;
        // La baja queda esperando el bloqueo de la parte mientras la habilitación no confirma...
        expect(await esperarBloqueo(dueno, anonimizando.pid)).toBe(true);
        let terminada = false;
        void anonimizando.anonimizar.then(
          () => (terminada = true),
          () => (terminada = true),
        );
        await new Promise((r) => setTimeout(r, 100));
        expect(terminada).toBe(false);
        // ...y sigue cuando la habilitación confirma.
        acepta(await s.confirmar());
        await anonimizando.anonimizar;
        expect(terminada).toBe(true);
      } finally {
        await s.cerrar();
        await otraConexion?.end();
      }
      // PENDIENTE (no es de esta migración): la ficha que quedó sobre una parte anonimizada la tiene que impedir la propia anonimización (fila 467: hoy solo
      // mira el saldo y los roles), con su prueba en ese PR.
    });
  });

  describe("siembra de las clases A_COBRAR", () => {
    it("las tres clases existen con el signo y los indicadores del brief; las demás no", async () => {
      if (base === null) return;
      const r = await dueno.query<{
        clase: string;
        signo: string;
        exige_detalle: boolean;
        admite_vencimiento: boolean;
      }>(
        "select clase, signo, exige_detalle, admite_vencimiento from clase_de_asiento where sentido = 'A_COBRAR' order by clase",
      );
      expect(r.rows).toEqual([
        { clase: "AJUSTE_DE_SALDO", signo: "±", exige_detalle: true, admite_vencimiento: false },
        {
          clase: "CARGO_DE_VENTA_A_CUENTA",
          signo: "+",
          exige_detalle: false,
          admite_vencimiento: true,
        },
        { clase: "COBRANZA", signo: "-", exige_detalle: false, admite_vencimiento: false },
      ]);
    });

    it("el libro rechaza una clase A_COBRAR no sembrada y acepta una sembrada", async () => {
      if (base === null) return;
      const parte = await crearParte();
      await conAppDe(b(), m, async (s) => {
        const insertar = (clase: string, importe: string) =>
          s.intentar(
            `insert into asiento_de_saldo (empresa_id, parte_id, sentido, clase, importe, origen_tipo, origen_id, clave_idempotencia, huella, hecho_en, registrado_por)
             values ($1, $2, 'A_COBRAR', $3, $4, 'ventas.cargo', gen_random_uuid(), $5, $6, now(), $7) returning id`,
            [m.empresa, parte, clase, importe, claveNueva(), HUELLA, m.persona],
          );
        referencia(await insertar("CREDITO_A_FAVOR", "-10"), "asiento_de_saldo_clase_fkey");
        acepta(await insertar("CARGO_DE_VENTA_A_CUENTA", "10"));
      });
    });
  });

  describe("migración y reversión", () => {
    it("correr la migración otra vez falla claro y no duplica la siembra; la reversión frena con fichas y el ciclo deja el mismo esquema", async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base);
      const c = new pg.Client({ connectionString: aparte.base.dueno });
      await c.connect();
      try {
        const reversion = await readFile(join(CARPETA_DE_MIGRACIONES, REVERSION), "utf8");
        const migracion = await readFile(join(CARPETA_DE_MIGRACIONES, MIGRACION), "utf8");
        const esquema = async (): Promise<string> =>
          JSON.stringify(
            (
              await c.query(
                `select 'c' as t, table_name || '.' || column_name || ':' || data_type as x from information_schema.columns where table_schema = 'public' and table_name = 'cuenta_del_cliente'
                 union all select 'k', conname || ':' || pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.cuenta_del_cliente'::regclass
                 union all select 'g', tgname from pg_trigger where not tgisinternal and tgrelid = 'public.cuenta_del_cliente'::regclass
                 union all select 'f', proname from pg_proc where proname = 'cuenta_del_cliente_validar'
                 union all select 'p', policyname from pg_policies where tablename = 'cuenta_del_cliente' order by 1, 2`,
              )
            ).rows,
          );
        const hay = async () =>
          (
            await c.query<{ v: boolean }>(
              "select to_regclass('public.cuenta_del_cliente') is not null as v",
            )
          ).rows[0]?.v === true;
        const correr = async (texto: string): Promise<string | null> => {
          try {
            await c.query(`begin; ${texto}; commit;`);
            return null;
          } catch (e) {
            await c.query("rollback");
            return (e as { message: string }).message;
          }
        };
        const clases = async () =>
          (
            await c.query<{ n: number }>(
              "select count(*)::int as n from clase_de_asiento where sentido = 'A_COBRAR'",
            )
          ).rows[0]?.n;

        const original = await esquema();
        expect(await hay()).toBe(true);
        expect(await clases()).toBe(3);
        // Sobre una base ya migrada, la migración se frena con un mensaje claro y no toca nada.
        expect(await correr(migracion)).toMatch(/ya existe/);
        expect(await clases()).toBe(3);

        expect(await correr(reversion)).toBeNull();
        expect(await hay()).toBe(false);
        expect(await clases()).toBe(3); // la siembra no se revierte
        expect(await correr(reversion)).toBeNull(); // repetida: no cambia nada
        expect(
          (await c.query("select 1 from migracion where nombre = $1", [MIGRACION])).rowCount,
        ).toBe(0);
        expect(await correr(migracion)).toBeNull(); // se vuelve a aplicar sin duplicar la siembra
        expect(await esquema()).toBe(original);
        expect(await clases()).toBe(3);

        // La migración la corre el dueño de la base de Neon, que NO evade RLS: con la RLS forzada de `clase_de_asiento` (0092) tiene que poder sembrar igual,
        // y la tabla tiene que quedar con la RLS forzada otra vez.
        expect(await correr(reversion)).toBeNull();
        const dueño = `dueno_sin_bypass_${sufijoUnico()}`;
        await c.query(`create role ${dueño} nologin nosuperuser nobypassrls`);
        try {
          await c.query(`alter table clase_de_asiento owner to ${dueño}`);
          await c.query(`grant create on schema public to ${dueño}`);
          await c.query(`grant execute on all functions in schema public to ${dueño}`);
          await c.query(`grant usage on schema public to ${dueño}`);
          await c.query(
            `grant references, select on empresa, persona, parte, parte_rol, rol_de_parte to ${dueño}`,
          );
          await c.query("delete from clase_de_asiento where false");
          // Sin la siembra previa visible, la corrida del dueño sin BYPASSRLS tiene que insertar las tres (si no, una de las dos queda con 3 y esta no probaría nada).
          await c.query(
            "alter table clase_de_asiento disable trigger clase_de_asiento_solo_insercion",
          );
          await c.query("delete from clase_de_asiento where sentido = 'A_COBRAR'");
          await c.query(
            "alter table clase_de_asiento enable trigger clase_de_asiento_solo_insercion",
          );
          expect(await clases()).toBe(0);
          expect(await correr(`set local role ${dueño}; ${migracion}`)).toBeNull();
          expect(await clases()).toBe(3);
          expect(
            (
              await c.query<{ f: boolean }>(
                "select relforcerowsecurity as f from pg_class where relname = 'clase_de_asiento'",
              )
            ).rows[0]?.f,
          ).toBe(true);
          // Sin el NO FORCE de la migración, ese dueño no podría sembrar: la prueba del propio riesgo.
          expect(await correr(reversion)).toBeNull();
          await c.query(
            "alter table clase_de_asiento disable trigger clase_de_asiento_solo_insercion",
          );
          await c.query("delete from clase_de_asiento where sentido = 'A_COBRAR'");
          await c.query(
            "alter table clase_de_asiento enable trigger clase_de_asiento_solo_insercion",
          );
          const sinSoltar = migracion
            .replace("ALTER TABLE clase_de_asiento NO FORCE ROW LEVEL SECURITY;", "")
            .replace(/ALTER TABLE clase_de_asiento FORCE ROW LEVEL SECURITY;\s*$/, "");
          expect(await correr(`set local role ${dueño}; ${sinSoltar}`)).toMatch(
            /row-level security/,
          );
          expect(await hay()).toBe(false);
        } finally {
          await c
            .query(`alter table clase_de_asiento owner to current_user`)
            .catch(() => undefined);
          await c.query(`drop owned by ${dueño}`).catch(() => undefined);
          await c.query(`drop role if exists ${dueño}`).catch(() => undefined);
        }
        // Se vuelve a dejar la base como estaba para el resto del caso.
        expect(await correr(migracion)).toBeNull();
        expect(await clases()).toBe(3);

        // Si algo falla DESPUÉS de soltar la fuerza de la RLS, la transacción revierte el ALTER: la tabla queda FORZADA y no queda nada a medias.
        expect(await correr(reversion)).toBeNull();
        const fallida = migracion.replace(
          /ALTER TABLE clase_de_asiento FORCE ROW LEVEL SECURITY;\s*$/,
          "INSERT INTO clase_de_asiento (sentido, clase, signo, exige_detalle, admite_vencimiento) VALUES ('A_COBRAR', 'x', '+', false, false);\nALTER TABLE clase_de_asiento FORCE ROW LEVEL SECURITY;",
        );
        expect(fallida).not.toBe(migracion);
        expect(await correr(fallida)).toMatch(/clase_de_asiento_clase_ck/);
        expect(await hay()).toBe(false);
        expect(
          (
            await c.query<{ f: boolean }>(
              "select relforcerowsecurity as f from pg_class where relname = 'clase_de_asiento'",
            )
          ).rows[0]?.f,
        ).toBe(true);
        expect(await correr(migracion)).toBeNull();
        expect(await clases()).toBe(3);

        // Con un rol sin BYPASSRLS el mensaje es claro y no se toca nada.
        const rol = `revisor_${sufijoUnico()}`;
        await c.query(`create role ${rol} nologin`);
        try {
          expect(await correr(`set local role ${rol}; ${reversion}`)).toMatch(/evada RLS/);
          expect(await hay()).toBe(true);
        } finally {
          await c.query(`drop role ${rol}`);
        }

        // Con una ficha cargada, la reversión se frena siempre.
        const mundo = await crearMundo(c);
        const parte = randomUUID();
        await c.query(
          `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
           values ($1, $2, gen_random_uuid(), 'JURIDICA', 'Cliente de reversión', 'CUIT', $3, $4)`,
          [parte, mundo.empresa, cuitUnico(), mundo.persona],
        );
        await c.query(
          "insert into parte_rol (empresa_id, parte_id, rol) values ($1, $2, 'CUSTOMER')",
          [mundo.empresa, parte],
        );
        await c.query(
          `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
           values ($1, $2, 30, 100, $3, $4, $5)`,
          [mundo.empresa, parte, claveNueva(), HUELLA, mundo.persona],
        );
        expect(await correr(reversion)).toMatch(/hay 1 fichas de cuenta corriente/);
        expect(await correr(`set local pedernal.confirmar_reversion = 'SI'; ${reversion}`)).toMatch(
          /hay 1 fichas/,
        );
        expect(await hay()).toBe(true);
      } finally {
        await c.end();
        await aparte.destruir();
      }
    });
  });
});

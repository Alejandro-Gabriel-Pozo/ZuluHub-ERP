import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import {
  cartaDeBase,
  comoPublico,
  empresaDeCarta,
  type EmpresaDeCarta,
} from "./carta-publica-apoyo";
import { comoEmpresa, crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import type { BaseDePruebas } from "./global";
import { SesionDePrueba, esperarBloqueo } from "./sesiones";

/**
 * 0102 (cuentas de imagen declaradas por empresa) contra una base real y con los roles reales: la forma de la tabla, el aislamiento entre empresas (aplicación y rol
 * público), el tope de 2 activas con dos altas SIMULTÁNEAS, que retirar no borra ni se deshace, la defensa en profundidad sobre `carta_publica` y la reversión.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const REVERSION = join(
  import.meta.dirname,
  "../../migraciones/reversiones/0102_revertir_cuentas_de_imagen_declaradas.sql",
);
const clave = (): string => randomBytes(16).toString("hex");
const huella = (): string => randomBytes(32).toString("hex");

const LOGO = {
  logo_proveedor: "CLOUDINARY",
  logo_id_publico: "logos/casa-central",
  logo_version: "1731700000",
  logo_extension: "png",
};

describe.skipIf(base === null)("migración 0102: cuentas de imagen declaradas", () => {
  const entorno = crearEntornoDePrueba(base as BaseDePruebas, 6);
  let dueno: pg.Client;
  let a: EmpresaDeCarta;
  let b: EmpresaDeCarta;
  let cartaA: { id: string; codigo: string };
  let cartaB: { id: string; codigo: string };

  /** Declara una cuenta con la aplicación real (rol `pedernal_app`, contexto firmado, RLS): devuelve el error de la base si lo hay. */
  const declarar = async (
    e: EmpresaDeCarta,
    cuenta: string,
    declaradaPor: string = e.persona,
  ): Promise<string | null> => {
    const s = await SesionDePrueba.abrir(
      base as BaseDePruebas,
      "pedernal_app",
      comoEmpresa(empresaId(e.empresa), personaId(e.persona)),
    );
    try {
      const r = await s.intentar(
        `insert into cuenta_de_imagen_declarada (id, empresa_id, proveedor, cuenta, clave_idempotencia, huella, declarada_por)
         values ($1, $2, 'CLOUDINARY', $3, $4, $5, $6)`,
        [randomUUID(), e.empresa, cuenta, clave(), huella(), declaradaPor],
      );
      if (r.ok) await s.confirmar();
      return r.ok ? null : `${r.codigo}:${r.restriccion ?? ""}`;
    } finally {
      await s.cerrar();
    }
  };
  const enApp = async <T>(
    e: EmpresaDeCarta,
    trabajo: (s: SesionDePrueba) => Promise<T>,
  ): Promise<T> => {
    const s = await SesionDePrueba.abrir(
      base as BaseDePruebas,
      "pedernal_app",
      comoEmpresa(empresaId(e.empresa), personaId(e.persona)),
    );
    try {
      return await trabajo(s);
    } finally {
      await s.cerrar();
    }
  };
  const activas = async (empresa: string): Promise<number> =>
    (
      await dueno.query<{ n: number }>(
        "select count(*)::int as n from cuenta_de_imagen_declarada where empresa_id = $1 and estado = 'ACTIVA'",
        [empresa],
      )
    ).rows[0]?.n as number;

  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
    await dueno.connect();
    a = await empresaDeCarta(entorno, dueno);
    b = await empresaDeCarta(entorno, dueno);
    cartaA = await cartaDeBase(dueno, a.empresa, a.s1);
    cartaB = await cartaDeBase(dueno, b.empresa, b.s1);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
  });

  it("la forma: proveedor y cuenta de la lista de permitidos, clave y huella con su forma, y los datos de retiro todos o ninguno", async () => {
    const mal = async (cuenta: string, proveedor = "CLOUDINARY") =>
      enApp(a, async (s) =>
        s.intentar(
          `insert into cuenta_de_imagen_declarada (empresa_id, proveedor, cuenta, clave_idempotencia, huella, declarada_por) values ($1, $2, $3, $4, $5, $6)`,
          [a.empresa, proveedor, cuenta, clave(), huella(), a.persona],
        ),
      );
    for (const cuenta of ["", "Mayuscula", "con espacio", "x".repeat(65), "a/b", "a.b"]) {
      const r = await mal(cuenta);
      expect(r.ok, cuenta).toBe(false);
      if (!r.ok) expect(r.restriccion, cuenta).toBe("cuenta_de_imagen_cuenta_ck");
    }
    const otro = await mal("ok", "IMAGEKIT");
    expect(!otro.ok && otro.restriccion).toBe("cuenta_de_imagen_proveedor_ck");
    const sinClave = await enApp(a, async (s) =>
      s.intentar(
        `insert into cuenta_de_imagen_declarada (empresa_id, proveedor, cuenta, clave_idempotencia, huella, declarada_por) values ($1, 'CLOUDINARY', 'ok', 'corta', $2, $3)`,
        [a.empresa, huella(), a.persona],
      ),
    );
    expect(!sinClave.ok && sinClave.restriccion).toBe("cuenta_de_imagen_clave_ck");
    // ACTIVA con datos de retiro, o RETIRADA sin ellos: el CHECK lo impide (el dueño de la base también).
    await dueno.query("begin");
    try {
      const huerfano = await dueno.query("savepoint s").then(() =>
        dueno
          .query(
            `insert into cuenta_de_imagen_declarada (empresa_id, proveedor, cuenta, clave_idempotencia, huella, declarada_por, motivo_de_retiro)
             values ($1, 'CLOUDINARY', 'con-motivo', $2, $3, $4, 'sin retirar')`,
            [a.empresa, clave(), huella(), a.persona],
          )
          .then(
            () => null,
            (e: { constraint?: string }) => e.constraint,
          ),
      );
      expect(huerfano).toBe("cuenta_de_imagen_retiro_ck");
    } finally {
      await dueno.query("rollback");
    }
  });

  it("aislamiento: la aplicación ve solo las cuentas de su empresa y no puede declarar ni retirar en otra", async () => {
    expect(await declarar(a, "cuenta-de-a")).toBeNull();
    expect(await declarar(b, "cuenta-de-b")).toBeNull();
    const vistasPorA = await enApp(a, async (s) =>
      s.intentar("select empresa_id, cuenta from cuenta_de_imagen_declarada"),
    );
    expect(vistasPorA.ok && vistasPorA.rows.map((r) => r["cuenta"])).toEqual(["cuenta-de-a"]);
    // A declara «para» B: la política de alta no lo deja (empresa distinta de la del contexto).
    const ajena = await enApp(a, async (s) =>
      s.intentar(
        `insert into cuenta_de_imagen_declarada (empresa_id, proveedor, cuenta, clave_idempotencia, huella, declarada_por) values ($1, 'CLOUDINARY', 'colada', $2, $3, $4)`,
        [b.empresa, clave(), huella(), a.persona],
      ),
    );
    expect(!ajena.ok && ajena.codigo).toBe("42501");
    // A intenta retirar la cuenta de B: no ve la fila, no actualiza nada.
    const retirarAjena = await enApp(a, async (s) =>
      s.intentar(
        `update cuenta_de_imagen_declarada set estado = 'RETIRADA', retirada_por = $2, motivo_de_retiro = 'intruso' where empresa_id = $1`,
        [b.empresa, a.persona],
      ),
    );
    expect(retirarAjena.ok && retirarAjena.filas).toBe(0);
    expect(await activas(b.empresa)).toBeGreaterThanOrEqual(1);
    // Declarar a nombre de otra persona tampoco.
    const aNombreDeOtro = await declarar(a, "otra-cuenta", b.persona);
    expect(aNombreDeOtro).not.toBeNull();
  });

  it("la misma cuenta puede estar declarada por dos empresas (no hay unicidad entre empresas); dentro de una empresa, activa una sola vez", async () => {
    const e1 = await empresaDeCarta(entorno, dueno);
    const e2 = await empresaDeCarta(entorno, dueno);
    expect(await declarar(e1, "agencia")).toBeNull();
    expect(await declarar(e2, "agencia")).toBeNull();
    expect(await declarar(e1, "agencia")).toBe("23505:cuenta_de_imagen_activa_uk");
  });

  it("rol público: con el código de la carta de A ve SOLO las cuentas activas de A; sin código, ninguna; las retiradas no", async () => {
    const publico = (base as BaseDePruebas).publico;
    const deA = await comoPublico<{ empresa_id: string; cuenta: string }>(
      publico,
      cartaA.codigo,
      "select empresa_id, cuenta from cuenta_de_imagen_declarada order by cuenta",
    );
    expect(deA.length).toBeGreaterThan(0);
    expect(new Set(deA.map((r) => r.empresa_id))).toEqual(new Set([a.empresa]));
    const deB = await comoPublico<{ empresa_id: string }>(
      publico,
      cartaB.codigo,
      "select empresa_id from cuenta_de_imagen_declarada",
    );
    expect(new Set(deB.map((r) => r.empresa_id))).toEqual(new Set([b.empresa]));
    expect(
      await comoPublico(publico, null, "select 1 from cuenta_de_imagen_declarada"),
    ).toHaveLength(0);
    expect(
      await comoPublico(publico, codigoInventado(), "select 1 from cuenta_de_imagen_declarada"),
    ).toHaveLength(0);
    // Solo las columnas otorgadas: nada de quién declaró ni de la clave.
    for (const columna of ["declarada_por", "clave_idempotencia", "huella", "motivo_de_retiro"]) {
      await expect(
        comoPublico(publico, cartaA.codigo, `select ${columna} from cuenta_de_imagen_declarada`),
      ).rejects.toMatchObject({ code: "42501" });
    }
    // Escribir, nada.
    const sp = await SesionDePrueba.abrir(base as BaseDePruebas, "pedernal_publico", null);
    try {
      await sp.directo("select set_config('app.codigo_de_carta', $1, true)", [cartaA.codigo]);
      for (const escribir of [
        "delete from cuenta_de_imagen_declarada",
        "update cuenta_de_imagen_declarada set estado = 'RETIRADA'",
        `insert into cuenta_de_imagen_declarada (empresa_id, proveedor, cuenta, clave_idempotencia, huella, declarada_por) values ('${a.empresa}', 'CLOUDINARY', 'x', 'a'||repeat('b',20), repeat('a',64), '${a.persona}')`,
      ]) {
        const r = await sp.intentar(escribir);
        expect(!r.ok && r.codigo, escribir).toBe("42501");
      }
    } finally {
      await sp.cerrar();
    }
    const retirada = await dueno.query<{ id: string }>(
      "select id from cuenta_de_imagen_declarada where empresa_id = $1 and cuenta = 'cuenta-de-a'",
      [a.empresa],
    );
    await enApp(a, async (s) => {
      const r = await s.intentar(
        `update cuenta_de_imagen_declarada set estado = 'RETIRADA', retirada_por = $2, motivo_de_retiro = 'ya no se usa' where id = $1`,
        [retirada.rows[0]?.id, a.persona],
      );
      expect(r.ok && r.filas).toBe(1);
      await s.confirmar();
    });
    const luego = await comoPublico<{ cuenta: string }>(
      publico,
      cartaA.codigo,
      "select cuenta from cuenta_de_imagen_declarada",
    );
    expect(luego.map((r) => r.cuenta)).not.toContain("cuenta-de-a");
  });

  it("retirar no borra ni se deshace: solo ACTIVA → RETIRADA, el momento lo fija la base, lo demás no cambia y nadie borra (ni el dueño)", async () => {
    const e = await empresaDeCarta(entorno, dueno);
    expect(await declarar(e, "x1")).toBeNull();
    const { rows } = await dueno.query<{ id: string }>(
      "select id from cuenta_de_imagen_declarada where empresa_id = $1",
      [e.empresa],
    );
    const id = rows[0]?.id as string;
    await dueno.query("begin");
    try {
      const falla = async (sql: string, p: unknown[]): Promise<string | null> => {
        await dueno.query("savepoint i");
        try {
          await dueno.query(sql, p);
          await dueno.query("release savepoint i");
          return null;
        } catch (er) {
          await dueno.query("rollback to savepoint i");
          const x = er as { code?: string; constraint?: string };
          return `${x.code}:${x.constraint ?? ""}`;
        }
      };
      expect(
        await falla("update cuenta_de_imagen_declarada set cuenta = 'otra' where id = $1", [id]),
      ).toBe("23514:cuenta_de_imagen_inmutable");
      expect(
        await falla("update cuenta_de_imagen_declarada set empresa_id = $2 where id = $1", [
          id,
          a.empresa,
        ]),
      ).toBe("23514:cuenta_de_imagen_inmutable");
      expect(
        await falla("delete from cuenta_de_imagen_declarada where id = $1", [id]),
      ).not.toBeNull();
      expect(await falla("truncate cuenta_de_imagen_declarada", [])).not.toBeNull();
      expect(
        await falla(
          "update cuenta_de_imagen_declarada set estado = 'RETIRADA', retirada_por = $2, motivo_de_retiro = 'cierre de la cuenta' where id = $1",
          [id, e.persona],
        ),
      ).toBeNull();
      const retirada = await dueno.query<{ retirada_en: Date | null; version: number }>(
        "select retirada_en, version from cuenta_de_imagen_declarada where id = $1",
        [id],
      );
      expect(retirada.rows[0]?.retirada_en).not.toBeNull();
      expect(retirada.rows[0]?.version).toBe(2);
      // Una retirada no vuelve a ACTIVA ni se re-retira.
      expect(
        await falla(
          "update cuenta_de_imagen_declarada set estado = 'ACTIVA', retirada_por = null, retirada_en = null, motivo_de_retiro = null where id = $1",
          [id],
        ),
      ).toBe("23514:cuenta_de_imagen_transicion_invalida");
      expect(
        await falla(
          "update cuenta_de_imagen_declarada set motivo_de_retiro = 'otro' where id = $1",
          [id],
        ),
      ).toBe("23514:cuenta_de_imagen_transicion_invalida");
    } finally {
      await dueno.query("rollback");
    }
  });

  it("tope: la tercera cuenta activa se rechaza; retirar una libera el cupo; volver a declarar la retirada es una fila nueva", async () => {
    const e = await empresaDeCarta(entorno, dueno);
    expect(await declarar(e, "uno")).toBeNull();
    expect(await declarar(e, "dos")).toBeNull();
    expect(await declarar(e, "tres")).toBe("23514:cuenta_de_imagen_tope");
    await enApp(e, async (s) => {
      const r = await s.intentar(
        `update cuenta_de_imagen_declarada set estado = 'RETIRADA', retirada_por = $2, motivo_de_retiro = 'libero el cupo' where empresa_id = $1 and cuenta = 'uno'`,
        [e.empresa, e.persona],
      );
      expect(r.ok && r.filas).toBe(1);
      await s.confirmar();
    });
    expect(await declarar(e, "tres")).toBeNull();
    expect(await declarar(e, "uno")).toBe("23514:cuenta_de_imagen_tope");
    expect(await activas(e.empresa)).toBe(2);
    const { rows } = await dueno.query<{ n: number }>(
      "select count(*)::int as n from cuenta_de_imagen_declarada where empresa_id = $1",
      [e.empresa],
    );
    expect(rows[0]?.n).toBe(3);
  });

  it("tope CONCURRENTE: con una activa, dos altas a la vez dejan exactamente dos; con dos activas, ninguna pasa", async () => {
    for (const ronda of [0, 1, 2]) {
      const e = await empresaDeCarta(entorno, dueno);
      expect(await declarar(e, `previa-${ronda}`)).toBeNull();
      const alta = async (cuenta: string, aislamiento: "read committed" | "serializable") => {
        const s = await SesionDePrueba.abrir(
          base as BaseDePruebas,
          "pedernal_app",
          comoEmpresa(empresaId(e.empresa), personaId(e.persona)),
          aislamiento,
        );
        // Una lectura previa fija la foto de la transacción serializable, como hace el adaptador antes de escribir.
        await s.directo("select count(*) from cuenta_de_imagen_declarada");
        return s;
      };
      const aislamiento = ronda === 0 ? "read committed" : "serializable";
      const s1 = await alta("c1", aislamiento);
      const s2 = await alta("c2", aislamiento);
      try {
        const sql = `insert into cuenta_de_imagen_declarada (empresa_id, proveedor, cuenta, clave_idempotencia, huella, declarada_por) values ($1, 'CLOUDINARY', $2, $3, $4, $5)`;
        const p1 = s1.directo(sql, [e.empresa, `nueva-${ronda}-1`, clave(), huella(), e.persona]);
        expect(await esperarBloqueo(dueno, s1.pid, 50)).toBe(false);
        const p2 = s2.directo(sql, [e.empresa, `nueva-${ronda}-2`, clave(), huella(), e.persona]);
        const [r1, r2] = await Promise.all([p1, p2]);
        // Cada una confirma lo suyo: ahí se ve quién gana (bajo SERIALIZABLE puede abortar al confirmar).
        const c1 = r1.ok ? await s1.confirmar() : r1;
        const c2 = r2.ok ? await s2.confirmar() : r2;
        const pasaron = [c1, c2].filter((r) => r.ok).length;
        expect(pasaron, JSON.stringify([c1, c2])).toBe(1);
        expect(await activas(e.empresa)).toBe(2);
      } finally {
        await s1.cerrar();
        await s2.cerrar();
      }
    }
  });

  it("defensa en profundidad: `carta_publica` no guarda un logo de una cuenta no declarada, ni de otra empresa, ni retirada — aunque el servidor se olvide", async () => {
    const e = await empresaDeCarta(entorno, dueno);
    const carta = await cartaDeBase(dueno, e.empresa, e.s1);
    const poner = async (cuenta: string | null): Promise<string | null> =>
      enApp(e, async (s) => {
        const r = await s.intentar(
          `update carta_publica set logo_proveedor = $2, logo_cuenta = $3, logo_id_publico = $4, logo_version = $5, logo_extension = $6 where id = $1`,
          cuenta === null
            ? [carta.id, null, null, null, null, null]
            : [
                carta.id,
                LOGO.logo_proveedor,
                cuenta,
                LOGO.logo_id_publico,
                LOGO.logo_version,
                LOGO.logo_extension,
              ],
        );
        if (r.ok) await s.confirmar();
        return r.ok ? null : `${r.codigo}:${r.restriccion ?? ""}`;
      });
    expect(await poner("sin-declarar")).toBe("23514:carta_publica_logo_cuenta_declarada");
    // La declara OTRA empresa: no alcanza.
    expect(await poner("cuenta-de-b")).toBe("23514:carta_publica_logo_cuenta_declarada");
    expect(await declarar(e, "mia")).toBeNull();
    expect(await poner("mia")).toBeNull();
    // Quitar el logo siempre se puede; un logo que NO cambia no se revalida aunque la cuenta se retire después.
    await dueno.query(
      `update cuenta_de_imagen_declarada set estado = 'RETIRADA', retirada_por = $2, motivo_de_retiro = 'prueba' where empresa_id = $1`,
      [e.empresa, e.persona],
    );
    expect(await poner("mia")).toBeNull();
    expect(
      await enApp(e, async (s) => {
        const r = await s.intentar(
          "update carta_publica set nombre = 'Otro nombre' where id = $1",
          [carta.id],
        );
        return r.ok ? null : r.mensaje;
      }),
    ).toBeNull();
    expect(await poner(null)).toBeNull();
    // Y la cuenta retirada ya no vale para un logo nuevo.
    expect(await poner("mia")).toBe("23514:carta_publica_logo_cuenta_declarada");
    // Un alta directa con logo también pasa por la misma defensa.
    const alta = await enApp(e, async (s) => {
      const r = await s.intentar(
        `insert into carta_publica (id, empresa_id, sucursal_id, codigo, nombre, estado, creado_por, logo_proveedor, logo_cuenta, logo_id_publico, logo_version, logo_extension)
         values ($1, $2, $3, $4, 'Otra', 'FUERA_DE_LINEA', $5, 'CLOUDINARY', 'fantasma', 'logos/x', '1', 'png')`,
        [randomUUID(), e.empresa, e.s2, randomBytes(16).toString("base64url"), e.persona],
      );
      return r.ok ? null : `${r.codigo}:${r.restriccion ?? ""}`;
    });
    expect(alta).toBe("23514:carta_publica_logo_cuenta_declarada");
  });

  it("modelo de confianza: solo la aplicación (con su empresa) escribe cuentas y logos; ningún otro rol (plataforma, grupo, trabajos, autenticación, captación) ni el público puede escribirlos, y sin contexto de empresa la aplicación tampoco", async () => {
    const { rows } = await dueno.query<{ rol: string; tabla: string; privilegio: string }>(
      `select grantee as rol, table_name as tabla, privilege_type as privilegio
         from information_schema.table_privileges
        where table_schema = 'public' and table_name = 'cuenta_de_imagen_declarada' and grantee like 'pedernal%'
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`,
    );
    // La aplicación escribe por COLUMNA (no figura a nivel de tabla); nadie más recibe nada.
    expect(rows).toEqual([]);
    const { rows: columnas } = await dueno.query<{
      rol: string;
      privilegio: string;
      columna: string;
    }>(
      `select grantee as rol, privilege_type as privilegio, column_name as columna
         from information_schema.column_privileges
        where table_schema = 'public'
          and ((table_name = 'cuenta_de_imagen_declarada' and privilege_type in ('INSERT', 'UPDATE'))
            or (table_name = 'carta_publica' and column_name like 'logo%' and privilege_type in ('INSERT', 'UPDATE')))
          and grantee like 'pedernal%'`,
    );
    expect([...new Set(columnas.map((c) => c.rol))]).toEqual(["pedernal_app"]);
    // La aplicación SIN empresa en el contexto (el contexto de un grupo o de la plataforma no es de una empresa): RLS no deja escribir ni ver cuentas.
    const sinEmpresa = await SesionDePrueba.abrir(base as BaseDePruebas, "pedernal_app", null);
    try {
      const alta = await sinEmpresa.intentar(
        `insert into cuenta_de_imagen_declarada (empresa_id, proveedor, cuenta, clave_idempotencia, huella, declarada_por) values ($1, 'CLOUDINARY', 'sin-empresa', $2, $3, $4)`,
        [a.empresa, clave(), huella(), a.persona],
      );
      expect(alta.ok).toBe(false);
      const ver = await sinEmpresa.intentar("select 1 from cuenta_de_imagen_declarada");
      expect(!ver.ok || ver.filas === 0).toBe(true);
    } finally {
      await sinEmpresa.cerrar();
    }
  });

  it("la reversión frena con cuentas declaradas y, sin ellas, deja la base como antes (y se puede repetir)", async () => {
    const guion = await readFile(REVERSION, "utf8");
    await expect(dueno.query(guion)).rejects.toMatchObject({ code: "55000" });
    // Sin tocar la base compartida: una base aparte con la migración aplicada y sin filas.
    const otra = await crearBaseAparte(base as BaseDePruebas);
    try {
      const c = new pg.Client({ connectionString: otra.base.dueno });
      await c.connect();
      try {
        await c.query("begin");
        await c.query(guion);
        await c.query(guion);
        const { rows } = await c.query<{ tabla: string | null; fn: string | null }>(
          `select to_regclass('public.cuenta_de_imagen_declarada')::text as tabla,
                  to_regprocedure('public.carta_publica_logo_declarado()')::text as fn`,
        );
        expect(rows[0]).toEqual({ tabla: null, fn: null });
        await c.query("rollback");
      } finally {
        await c.end();
      }
    } finally {
      await otra.destruir();
    }
  });
});

/** Un código con la forma del real pero que no es de ninguna carta. */
const codigoInventado = (): string => randomBytes(16).toString("base64url");

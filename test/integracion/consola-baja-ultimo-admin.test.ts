import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { darDeBajaAlAdmin } from "../../src/adaptadores/postgres/baja-de-admin";
import { ejecutarBajaDeAdmin } from "../../scripts/ejecutar-baja-de-admin";
import { VARIABLE_DE_LA_CADENA } from "../../scripts/entrada-del-dueno";
import { altaDeAdmin, type AdminDePrueba } from "./autenticacion-plataforma-apoyo";
import { crearBaseAparte } from "./entorno";

/**
 * La guarda del último ADMIN en `plataforma:baja-admin` (h5-p8 §2.5): no se da de baja a un ADMIN activo si no quedaría
 * ningún otro ADMIN activo (un SOPORTE no cuenta), sin bandera para saltearla, con la lectura y la baja en la misma
 * transacción serializable. Base propia: cada prueba deja EXACTAMENTE los administradores que necesita.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describe.skipIf(base === null)("la guarda del último ADMIN en la baja", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  /** Deja activos SOLO a esos administradores (los demás, de baja). */
  async function soloActivos(...quienes: AdminDePrueba[]) {
    await dueno.query("update admin_plataforma set activo = false where activo");
    for (const a of quienes) {
      await dueno.query("update admin_plataforma set activo = true where id = $1", [a.adminId]);
    }
  }
  const activo = async (a: AdminDePrueba) =>
    (
      await dueno.query<{ activo: boolean }>("select activo from admin_plataforma where id = $1", [
        a.adminId,
      ])
    ).rows[0]?.activo;
  const constancias = async (a: AdminDePrueba) =>
    Number(
      (
        await dueno.query<{ n: string }>(
          "select count(*) as n from auditoria_plataforma where accion = 'ADMIN_PLATAFORMA_BAJA' and entidad_id = $1",
          [a.adminId],
        )
      ).rows[0]?.n,
    );
  const sesiones = async (a: AdminDePrueba) =>
    Number(
      (
        await dueno.query<{ n: string }>(
          `select count(*) as n from autenticacion.session s join autenticacion."user" u on u.id = s."userId" where u.email = $1`,
          [a.email],
        )
      ).rows[0]?.n,
    );
  /** Un usuario de la librería con dos sesiones para ese administrador. */
  async function conSesiones(a: AdminDePrueba) {
    const { rows } = await dueno.query<{ id: string }>(
      `insert into autenticacion."user" (name, email, "emailVerified") values ('x', $1, true) returning id`,
      [a.email],
    );
    for (let i = 0; i < 2; i++) {
      await dueno.query(
        `insert into autenticacion.session (token, "expiresAt", "userId", host)
         values ($1, now() + interval '1 hour', $2, 'consola.example.test')`,
        [`tok-${a.adminId}-${i}`, rows[0]?.id],
      );
    }
  }
  async function correrBaja(a: AdminDePrueba) {
    const salida: string[] = [];
    const errores: string[] = [];
    const codigo = await ejecutarBajaDeAdmin({
      argumentos: [a.email],
      entorno: { [VARIABLE_DE_LA_CADENA]: propia.base.dueno },
      info: (l) => salida.push(l),
      error: (l) => errores.push(l),
    });
    return { codigo, salida, errores, texto: [...salida, ...errores].join("\n") };
  }

  it("el único ADMIN activo no se da de baja, aunque haya un SOPORTE: sale con 1, explica qué hacer y no cambia nada", async () => {
    const admin = await altaDeAdmin(dueno);
    const soporte = await altaDeAdmin(dueno, { rol: "SOPORTE" });
    await soloActivos(admin, soporte);
    await conSesiones(admin);
    const auditoriaAntes = await dueno.query("select count(*)::int as n from auditoria_plataforma");

    const r = await correrBaja(admin);
    expect(r.codigo).toBe(1);
    expect(r.salida).toEqual([]);
    expect(r.errores).toHaveLength(2);
    expect(r.errores[0]).toContain("Es el único ADMIN activo");
    expect(r.errores[0]).toContain("npm run plataforma:primer-admin");
    expect(r.errores[1]).toBe("RESULTADO: RECHAZADO (no se cambió nada).");
    expect(r.texto).not.toContain(admin.email);

    expect(await activo(admin)).toBe(true);
    expect(await sesiones(admin)).toBe(2);
    expect(await constancias(admin)).toBe(0);
    expect(await dueno.query("select count(*)::int as n from auditoria_plataforma")).toEqual(
      auditoriaAntes,
    );
    // Por la función directa, el mismo rechazo.
    expect(await darDeBajaAlAdmin(propia.base.dueno, admin.email)).toEqual({
      ok: false,
      error: "ES_EL_ULTIMO_ADMIN",
    });
  });

  it("con otro ADMIN activo la baja sigue igual; después ya no se puede dar de baja al que queda", async () => {
    const a = await altaDeAdmin(dueno);
    const b = await altaDeAdmin(dueno);
    await soloActivos(a, b);
    await conSesiones(a);
    const primera = await correrBaja(a);
    expect(primera.codigo).toBe(0);
    expect(primera.salida[0]).toContain("quedó dado de baja");
    expect(await activo(a)).toBe(false);
    expect(await sesiones(a)).toBe(0);
    expect(await constancias(a)).toBe(1);
    const ultimo = await correrBaja(b);
    expect(ultimo.codigo).toBe(1);
    expect(await activo(b)).toBe(true);
  });

  it("el SOPORTE se da de baja sin condiciones, aunque no quede ningún ADMIN activo", async () => {
    const soporte = await altaDeAdmin(dueno, { rol: "SOPORTE" });
    await soloActivos(soporte);
    const r = await correrBaja(soporte);
    expect(r.codigo).toBe(0);
    expect(r.salida[0]).toContain("quedó dado de baja");
    expect(await activo(soporte)).toBe(false);
  });

  it("repetir la baja de uno ya dado de baja dice «ya estaba» aunque no quede ningún ADMIN activo", async () => {
    const a = await altaDeAdmin(dueno);
    const b = await altaDeAdmin(dueno);
    await soloActivos(a, b);
    expect((await correrBaja(a)).codigo).toBe(0);
    // Ahora b es el último; repetir la baja de a no es un rechazo.
    const otraVez = await correrBaja(a);
    expect(otraVez.codigo).toBe(0);
    expect(otraVez.salida[0]).toContain("ya estaba dado de baja");
    // Y aun sin ningún ADMIN activo (b dado de baja a mano por el dueño con SQL), sigue siendo «ya estaba».
    await soloActivos();
    const sinNadie = await correrBaja(a);
    expect(sinNadie.codigo).toBe(0);
    expect(sinNadie.salida[0]).toContain("ya estaba dado de baja");
    expect(await constancias(a)).toBe(1);
  });

  it("dos bajas simultáneas de los dos únicos ADMIN: una sola gana y la otra se rechaza (concurrencia real, varias rondas)", async () => {
    for (let ronda = 0; ronda < 8; ronda++) {
      const a = await altaDeAdmin(dueno);
      const b = await altaDeAdmin(dueno);
      await soloActivos(a, b);
      const resultados = await Promise.all([
        darDeBajaAlAdmin(propia.base.dueno, a.email),
        darDeBajaAlAdmin(propia.base.dueno, b.email),
        darDeBajaAlAdmin(propia.base.dueno, a.email),
        darDeBajaAlAdmin(propia.base.dueno, b.email),
      ]);
      const hechas = resultados.filter((r) => r.ok && !r.valor.yaEstabaDeBaja);
      const rechazadas = resultados.filter((r) => !r.ok);
      expect(hechas, `ronda ${ronda}`).toHaveLength(1);
      expect(rechazadas.every((r) => !r.ok && r.error === "ES_EL_ULTIMO_ADMIN")).toBe(true);
      const activos = ((await activo(a)) ? 1 : 0) + ((await activo(b)) ? 1 : 0);
      expect(activos, `ronda ${ronda}: tiene que quedar exactamente un ADMIN activo`).toBe(1);
      expect((await constancias(a)) + (await constancias(b))).toBe(1);
    }
  });
});

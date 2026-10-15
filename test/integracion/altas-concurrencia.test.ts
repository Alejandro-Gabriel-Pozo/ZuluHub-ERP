import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import {
  altaEnTenant,
  altaNueva,
  comoAdminAhora,
  crearCasosDeAlta,
  crearEntornoDeAlta,
  crearMarcaLista,
  crearTenantConPlan,
  type TxDeAltaDePrueba,
} from "./altas-apoyo";
import { crearBarrera, crearBaseAparte, cuitAlAzar } from "./entorno";
import { emailAlAzar } from "./fixtures-identidad";
import { claveAlAzar } from "./plataforma-apoyo";

/**
 * Concurrencia del alta de empresa (H5 P5 y M6), contra Postgres real y con barrera: todas las
 * transacciones LEEN antes de que ninguna escriba, así que las carreras ocurren de verdad (no por casualidad
 * de tiempos). Cada prueba se repite varias veces con datos nuevos. Base propia: SERIALIZABLE aborta por
 * falsos positivos si otros archivos escriben las mismas tablas en paralelo.
 */

const base = inject("baseDePruebas");
const VUELTAS = 12;

const valores = <T>(rs: ReadonlyArray<Resultado<T, unknown>>) =>
  rs.flatMap((r) => (r.ok ? [r.valor] : []));
const errores = (rs: ReadonlyArray<Resultado<unknown, unknown>>) =>
  rs.flatMap((r) => (r.ok ? [] : [r.error]));

describe.skipIf(base === null)("alta de empresa: concurrencia", () => {
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

  /**
   * Un entorno cuyas transacciones esperan en una barrera DESPUÉS de leer y ANTES de escribir: en `consultar`
   * (la clave de idempotencia) o al contar las empresas del tenant (`listarDelTenant`, la lectura del tope).
   */
  function conBarrera(participantes: number, donde: "consultar" | "contar") {
    const barrera = crearBarrera(participantes);
    const entorno: TransaccionesDePostgres<TxDeAltaDePrueba> = crearEntornoDeAlta(
      propia.base,
      participantes + 2,
      (tx) => ({
        ...tx,
        idempotencia: {
          ...tx.idempotencia,
          consultar: async (...a) => {
            const r = await tx.idempotencia.consultar(...a);
            if (donde === "consultar") await barrera();
            return r;
          },
        },
        empresas: {
          ...tx.empresas,
          listarDelTenant: async (...a) => {
            const r = await tx.empresas.listarDelTenant(...a);
            if (donde === "contar") await barrera();
            return r;
          },
        },
      }),
    );
    return { entorno, casos: crearCasosDeAlta(entorno) };
  }

  const cuenta = async (texto: string, parametros: unknown[] = []) =>
    Number(((await dueno.query(texto, parametros)).rows[0] as { n: string }).n);
  const empresasVivas = (tenant: string) =>
    cuenta(
      "select count(*)::int as n from empresa where tenant_id = $1 and estado <> 'CANCELLED'",
      [tenant],
    );

  describe("la misma clave a la vez (un clic doble, un reintento del navegador)", () => {
    it("N pedidos simultáneos con la misma clave: uno crea, los demás devuelven lo mismo (yaExistia) y no queda nada duplicado", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const participantes = 5;
        const { entorno, casos } = conBarrera(participantes, "consultar");
        try {
          const m = await crearMarcaLista(dueno, {
            modulosIniciales: ["caja"],
            modulosDelPlan: ["caja"],
          });
          const entrada = altaNueva(m.marca);
          const antes = {
            tenants: await cuenta("select count(*)::int as n from tenant"),
            empresas: await cuenta("select count(*)::int as n from empresa"),
            invitaciones: await cuenta("select count(*)::int as n from invitacion"),
            trabajos: await cuenta("select count(*)::int as n from trabajo"),
            plataforma: await cuenta("select count(*)::int as n from auditoria_plataforma"),
            empresa: await cuenta("select count(*)::int as n from auditoria_empresa"),
            modulos: await cuenta("select count(*)::int as n from modulo_de_empresa"),
            claves: await cuenta("select count(*)::int as n from idempotencia_plataforma"),
          };
          const rs = await Promise.all(
            Array.from({ length: participantes }, () =>
              casos.altaDeEmpresa(comoAdminAhora(), entrada),
            ),
          );
          expect(errores(rs), `vuelta ${vuelta}`).toEqual([]);
          const vs = valores(rs);
          expect(vs.filter((v) => !v.yaExistia)).toHaveLength(1);
          const creada = vs.find((v) => !v.yaExistia);
          for (const v of vs) {
            expect({ ...v, yaExistia: false }).toEqual({ ...creada, yaExistia: false });
          }
          expect({
            tenants: (await cuenta("select count(*)::int as n from tenant")) - antes.tenants,
            empresas: (await cuenta("select count(*)::int as n from empresa")) - antes.empresas,
            invitaciones:
              (await cuenta("select count(*)::int as n from invitacion")) - antes.invitaciones,
            trabajos: (await cuenta("select count(*)::int as n from trabajo")) - antes.trabajos,
            plataforma:
              (await cuenta("select count(*)::int as n from auditoria_plataforma")) -
              antes.plataforma,
            empresa:
              (await cuenta("select count(*)::int as n from auditoria_empresa")) - antes.empresa,
            modulos:
              (await cuenta("select count(*)::int as n from modulo_de_empresa")) - antes.modulos,
            claves:
              (await cuenta("select count(*)::int as n from idempotencia_plataforma")) -
              antes.claves,
          }).toEqual({
            tenants: 1,
            empresas: 1,
            invitaciones: 1,
            trabajos: 1,
            plataforma: 2,
            empresa: 3,
            modulos: 1,
            claves: 1,
          });
        } finally {
          await entorno.cerrar();
        }
      }
    });

    it("la misma clave a la vez con datos DISTINTOS: gana uno y el otro es CLAVE_REUTILIZADA; queda un solo alta", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { entorno, casos } = conBarrera(2, "consultar");
        try {
          const m = await crearMarcaLista(dueno);
          const clave = claveAlAzar();
          const antes = await cuenta("select count(*)::int as n from empresa");
          const rs = await Promise.all([
            casos.altaDeEmpresa(
              comoAdminAhora(),
              altaNueva(m.marca, { claveDeIdempotencia: clave }),
            ),
            casos.altaDeEmpresa(
              comoAdminAhora(),
              altaNueva(m.marca, { claveDeIdempotencia: clave }),
            ),
          ]);
          expect(valores(rs), `vuelta ${vuelta}`).toHaveLength(1);
          expect(errores(rs)).toEqual(["CLAVE_REUTILIZADA"]);
          expect((await cuenta("select count(*)::int as n from empresa")) - antes).toBe(1);
        } finally {
          await entorno.cerrar();
        }
      }
    });
  });

  describe("el tope de empresas del tenant (`empresas_por_tenant`)", () => {
    it("dos altas distintas a la vez en un tenant con una empresa y tope 2: entra una y la otra es LIMITE_DEL_PLAN; quedan exactamente 2", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { entorno, casos } = conBarrera(2, "contar");
        try {
          const m = await crearMarcaLista(dueno);
          const mundo = await crearTenantConPlan(dueno, m, { empresasPorTenant: "2" });
          const rs = await Promise.all([
            casos.altaDeEmpresa(comoAdminAhora(), altaEnTenant(mundo.tenant)),
            casos.altaDeEmpresa(comoAdminAhora(), altaEnTenant(mundo.tenant)),
          ]);
          expect(valores(rs), `vuelta ${vuelta}`).toHaveLength(1);
          expect(errores(rs)).toEqual([
            { codigo: "LIMITE_DEL_PLAN", perilla: "empresas_por_tenant", limite: 2, usoActual: 2 },
          ]);
          expect(await empresasVivas(mundo.tenant)).toBe(2);
        } finally {
          await entorno.cerrar();
        }
      }
    });

    it("N altas a la vez con lugar para K: entran exactamente K y las demás son LIMITE_DEL_PLAN", async () => {
      for (let vuelta = 0; vuelta < 6; vuelta++) {
        const participantes = 5;
        const lugares = 2;
        const { entorno, casos } = conBarrera(participantes, "contar");
        try {
          const m = await crearMarcaLista(dueno);
          // El tenant ya tiene una empresa: con tope 3 caben 2 más.
          const mundo = await crearTenantConPlan(dueno, m, { empresasPorTenant: "3" });
          const rs = await Promise.all(
            Array.from({ length: participantes }, () =>
              casos.altaDeEmpresa(comoAdminAhora(), altaEnTenant(mundo.tenant)),
            ),
          );
          expect(valores(rs), `vuelta ${vuelta}`).toHaveLength(lugares);
          expect(errores(rs)).toHaveLength(participantes - lugares);
          for (const e of errores(rs)) expect(e).toMatchObject({ codigo: "LIMITE_DEL_PLAN" });
          expect(await empresasVivas(mundo.tenant)).toBe(3);
        } finally {
          await entorno.cerrar();
        }
      }
    });
  });

  describe("datos que no se pueden repetir", () => {
    it("el mismo CUIT a la vez con claves distintas: una empresa y el resto CUIT_DUPLICADO (también entre tenants nuevos)", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const participantes = 4;
        const { entorno, casos } = conBarrera(participantes, "consultar");
        try {
          const m = await crearMarcaLista(dueno);
          const cuit = cuitAlAzar();
          const rs = await Promise.all(
            Array.from({ length: participantes }, () =>
              casos.altaDeEmpresa(comoAdminAhora(), altaNueva(m.marca, { cuit })),
            ),
          );
          expect(valores(rs), `vuelta ${vuelta}`).toHaveLength(1);
          expect(errores(rs)).toEqual(Array(participantes - 1).fill("CUIT_DUPLICADO"));
          expect(
            await cuenta("select count(*)::int as n from empresa where cuit = $1", [cuit]),
          ).toBe(1);
          // Ni el tenant ni la invitación de los que perdieron: un solo tenant, una sola invitación.
          expect(
            await cuenta("select count(*)::int as n from tenant t where t.marca_id = $1", [
              m.marca,
            ]),
          ).toBe(1);
        } finally {
          await entorno.cerrar();
        }
      }
    });

    it("dos altas a la vez con el MISMO email de gerente (empresas y tenants distintos): las dos entran, cada una con su invitación y su mail", async () => {
      for (let vuelta = 0; vuelta < 6; vuelta++) {
        const { entorno, casos } = conBarrera(2, "consultar");
        try {
          const m = await crearMarcaLista(dueno);
          const email = emailAlAzar("mismo");
          const rs = await Promise.all([
            casos.altaDeEmpresa(comoAdminAhora(), altaNueva(m.marca, { emailGerente: email })),
            casos.altaDeEmpresa(comoAdminAhora(), altaNueva(m.marca, { emailGerente: email })),
          ]);
          expect(errores(rs), `vuelta ${vuelta}`).toEqual([]);
          const [a, b] = valores(rs);
          expect(a?.invitacionId).not.toBe(b?.invitacionId);
          expect(a?.empresaId).not.toBe(b?.empresaId);
          expect(
            await cuenta(
              "select count(*)::int as n from invitacion where email = $1 and estado = 'PENDIENTE'",
              [email],
            ),
          ).toBe(2);
          expect(
            await cuenta(
              `select count(*)::int as n from trabajo
               where tipo = 'enviar_invitacion' and empresa_id in ($1, $2)`,
              [a?.empresaId, b?.empresaId],
            ),
          ).toBe(2);
        } finally {
          await entorno.cerrar();
        }
      }
    });
  });

  describe("contra otros cambios del tenant", () => {
    it("alta contra la suspensión del tenant: si el tenant se suspende después de que el alta lo leyó activo, la empresa NO nace", async () => {
      for (let vuelta = 0; vuelta < 6; vuelta++) {
        const m = await crearMarcaLista(dueno);
        const mundo = await crearTenantConPlan(dueno, m, { empresasPorTenant: "5" });
        // El alta lee el tenant y se detiene; mientras tanto el dueño lo suspende; después sigue.
        let leido: () => void = () => undefined;
        const yaLeyo = new Promise<void>((resolver) => {
          leido = resolver;
        });
        let seguir: () => void = () => undefined;
        const puedeSeguir = new Promise<void>((resolver) => {
          seguir = resolver;
        });
        const entorno = crearEntornoDeAlta(propia.base, 4, (tx) => ({
          ...tx,
          tenants: {
            ...tx.tenants,
            obtener: async (...a) => {
              const r = await tx.tenants.obtener(...a);
              leido();
              await puedeSeguir;
              return r;
            },
          },
        }));
        try {
          const alta = crearCasosDeAlta(entorno).altaDeEmpresa(
            comoAdminAhora(),
            altaEnTenant(mundo.tenant),
          );
          await yaLeyo;
          await dueno.query(
            "update tenant set estado = 'SUSPENDED', motivo_estado = 'mora' where id = $1",
            [mundo.tenant],
          );
          seguir();
          const r = await alta;
          expect(r.ok, `vuelta ${vuelta}`).toBe(false);
          expect(r.ok ? null : r.error).toBe("TENANT_NO_ACTIVO");
          expect(await empresasVivas(mundo.tenant)).toBe(1);
        } finally {
          await entorno.cerrar();
        }
      }
    });
  });
});

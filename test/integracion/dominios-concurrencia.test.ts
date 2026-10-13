import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { CasosDeUsoDeDominios } from "../../src/plataforma/casos-de-uso/dominios";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import {
  auditoriaDeDominio,
  comoAdminDePlataforma as comoAdmin,
  crearCasosDeDominios,
  crearEntornoDeDominios,
  filaDeDominio,
  type TxDeDominiosDePrueba,
} from "./dominios-apoyo";
import { crearBarrera, crearBaseAparte } from "./entorno";
import { crearDominio, crearMarca, hostAlAzar, marcaPrincipal } from "./marcas-apoyo";
import { claveAlAzar } from "./plataforma-apoyo";

/**
 * Concurrencia de los casos de dominios de plataforma (M4a), contra Postgres real y con barrera: todas las
 * transacciones LEEN antes de que ninguna escriba, así que las carreras ocurren de verdad (no por casualidad
 * de tiempos). Cada prueba se repite varias veces con datos nuevos. Base propia: SERIALIZABLE aborta por
 * falsos positivos si otros archivos escriben las mismas tablas en paralelo.
 */

const base = inject("baseDePruebas");
const VUELTAS = 4;
const VERIFICADO_EN = new Date("2026-10-11T11:00:00.000Z");

const valores = <T>(rs: ReadonlyArray<Resultado<T, unknown>>) =>
  rs.flatMap((r) => (r.ok ? [r.valor] : []));
const errores = (rs: ReadonlyArray<Resultado<unknown, unknown>>) =>
  rs.flatMap((r) => (r.ok ? [] : [r.error]));

describe.skipIf(base === null)("dominios de plataforma: concurrencia", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let principal: string;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    principal = await marcaPrincipal(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  /**
   * Un entorno cuyas transacciones esperan en una barrera DESPUÉS de leer y ANTES de escribir: en
   * `consultar` (la clave de idempotencia) o en `obtener` (el dominio que van a cambiar).
   */
  function conBarrera(participantes: number, donde: "consultar" | "obtener") {
    const barrera = crearBarrera(participantes);
    const entorno: TransaccionesDePostgres<TxDeDominiosDePrueba> = crearEntornoDeDominios(
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
        dominios: {
          ...tx.dominios,
          obtener: async (...a) => {
            const r = await tx.dominios.obtener(...a);
            if (donde === "obtener") await barrera();
            return r;
          },
        },
      }),
    );
    return { entorno, casos: crearCasosDeDominios(entorno) };
  }

  const cuenta = async (texto: string, parametros: unknown[] = []) =>
    Number(((await dueno.query(texto, parametros)).rows[0] as { n: string }).n);
  const vigentesDelHost = (host: string) =>
    cuenta("select count(*)::int as n from dominio where host = $1 and estado <> 'RETIRADO'", [
      host,
    ]);
  const constanciasDe = (accion: string, host: string) =>
    cuenta(
      `select count(*)::int as n from auditoria_plataforma
       where accion = $1 and despues ->> 'host' = $2`,
      [accion, host],
    );
  const claves = () => cuenta("select count(*)::int as n from idempotencia_plataforma");

  const altaDe = (
    casos: CasosDeUsoDeDominios,
    host: string,
    extra: Partial<Parameters<CasosDeUsoDeDominios["agregarDominio"]>[1]> = {},
  ) =>
    casos.agregarDominio(comoAdmin(), {
      claveDeIdempotencia: claveAlAzar(),
      host,
      superficie: "APP",
      titular: "OPERADOR",
      esCanonico: false,
      duenio: { tipo: "MARCA", marcaId: principal },
      ...extra,
    });

  describe("agregar", () => {
    it("N altas del mismo host a la vez, con claves distintas: una gana, las demás son HOST_DUPLICADO, y queda una fila, una constancia y una clave", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const participantes = 6;
        const { entorno, casos } = conBarrera(participantes, "consultar");
        try {
          const host = hostAlAzar();
          const clavesAntes = await claves();
          const rs = await Promise.all(
            Array.from({ length: participantes }, () => altaDe(casos, host)),
          );
          expect(valores(rs)).toHaveLength(1);
          expect(errores(rs)).toEqual(Array(participantes - 1).fill("HOST_DUPLICADO"));
          expect(await vigentesDelHost(host)).toBe(1);
          expect(await constanciasDe("DOMINIO_AGREGADO", host)).toBe(1);
          expect(await claves()).toBe(clavesAntes + 1);
        } finally {
          await entorno.cerrar();
        }
      }
    });

    it("dos marcas agregan el mismo host a la vez: una gana y la otra es HOST_DUPLICADO", async () => {
      const { entorno, casos } = conBarrera(2, "consultar");
      try {
        const host = hostAlAzar();
        const [a, b] = [await crearMarca(dueno), await crearMarca(dueno)];
        const rs = await Promise.all([
          altaDe(casos, host, { duenio: { tipo: "MARCA", marcaId: a } }),
          altaDe(casos, host, { duenio: { tipo: "MARCA", marcaId: b }, superficie: "CARTA" }),
        ]);
        expect(valores(rs)).toHaveLength(1);
        expect(errores(rs)).toEqual(["HOST_DUPLICADO"]);
        expect(await vigentesDelHost(host)).toBe(1);
      } finally {
        await entorno.cerrar();
      }
    });

    it("dos dominios canónicos de la misma marca y superficie a la vez: uno gana y el otro es YA_TIENE_CANONICO; de superficies distintas, los dos", async () => {
      const { entorno, casos } = conBarrera(2, "consultar");
      try {
        const marca = await crearMarca(dueno);
        const duenio = { tipo: "MARCA", marcaId: marca } as const;
        const mismas = await Promise.all([
          altaDe(casos, hostAlAzar(), { duenio, esCanonico: true, superficie: "APP" }),
          altaDe(casos, hostAlAzar(), { duenio, esCanonico: true, superficie: "APP" }),
        ]);
        expect(valores(mismas)).toHaveLength(1);
        expect(errores(mismas)).toEqual(["YA_TIENE_CANONICO"]);
        const distintas = await Promise.all([
          altaDe(casos, hostAlAzar(), { duenio, esCanonico: true, superficie: "CARTA" }),
          altaDe(casos, hostAlAzar(), { duenio, esCanonico: true, superficie: "LANDING" }),
        ]);
        expect(valores(distintas)).toHaveLength(2);
      } finally {
        await entorno.cerrar();
      }
    });

    it("la MISMA clave y el mismo pedido a la vez: todos ok con el mismo dominio, uno solo lo registra, y queda una fila, una constancia y una clave", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const participantes = 4;
        const { entorno, casos } = conBarrera(participantes, "consultar");
        try {
          const host = hostAlAzar();
          const clave = claveAlAzar();
          const clavesAntes = await claves();
          const rs = await Promise.all(
            Array.from({ length: participantes }, () =>
              altaDe(casos, host, { claveDeIdempotencia: clave }),
            ),
          );
          const ok = valores(rs);
          expect(errores(rs)).toEqual([]);
          expect(ok).toHaveLength(participantes);
          expect(new Set(ok.map((v) => v.dominioId)).size).toBe(1);
          expect(ok.filter((v) => !v.yaExistia)).toHaveLength(1);
          expect(await vigentesDelHost(host)).toBe(1);
          expect(await constanciasDe("DOMINIO_AGREGADO", host)).toBe(1);
          expect(await claves()).toBe(clavesAntes + 1);
        } finally {
          await entorno.cerrar();
        }
      }
    });

    it("la misma clave con pedidos DISTINTOS a la vez: uno gana y el otro es CLAVE_REUTILIZADA, sin dejar su dominio", async () => {
      const { entorno, casos } = conBarrera(2, "consultar");
      try {
        const clave = claveAlAzar();
        const [hostA, hostB] = [hostAlAzar(), hostAlAzar()];
        const rs = await Promise.all([
          altaDe(casos, hostA, { claveDeIdempotencia: clave }),
          altaDe(casos, hostB, { claveDeIdempotencia: clave }),
        ]);
        expect(valores(rs)).toHaveLength(1);
        expect(errores(rs)).toEqual(["CLAVE_REUTILIZADA"]);
        expect((await vigentesDelHost(hostA)) + (await vigentesDelHost(hostB))).toBe(1);
        expect(
          (await constanciasDe("DOMINIO_AGREGADO", hostA)) +
            (await constanciasDe("DOMINIO_AGREGADO", hostB)),
        ).toBe(1);
      } finally {
        await entorno.cerrar();
      }
    });

    it("registrar un host a la vez que se retira el dominio que lo tenía: nunca quedan dos vigentes del mismo host", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { entorno, casos } = conBarrera(2, "consultar");
        try {
          const marca = await crearMarca(dueno);
          const viejo = await crearDominio(dueno, marca, { estado: "ACTIVO" });
          const rs = await Promise.all([
            altaDe(casos, viejo.host, { duenio: { tipo: "MARCA", marcaId: marca } }),
            casos.retirarDominio(comoAdmin(), {
              claveDeIdempotencia: claveAlAzar(),
              dominioId: viejo.id,
              motivo: "se fue el cliente",
            }),
          ]);
          // El retiro siempre se aplica; el alta entra si va después del retiro y es HOST_DUPLICADO si va antes.
          expect(rs[1].ok).toBe(true);
          expect((await filaDeDominio(dueno, viejo.id)).estado).toBe("RETIRADO");
          const alta = rs[0];
          if (!alta.ok) expect(alta.error).toBe("HOST_DUPLICADO");
          expect(await vigentesDelHost(viejo.host)).toBe(alta.ok ? 1 : 0);
        } finally {
          await entorno.cerrar();
        }
      }
    });
  });

  describe("cambios de estado", () => {
    const nuevo = async (estado: "PENDIENTE_VERIFICACION" | "VERIFICADO" | "ACTIVO") => {
      const marca = await crearMarca(dueno);
      return crearDominio(dueno, marca, { estado });
    };
    const pedido = <T extends object>(id: string, extra: T) => ({
      claveDeIdempotencia: claveAlAzar(),
      dominioId: id,
      ...extra,
    });

    it("dos activar del mismo dominio a la vez (claves distintas): una sola transición, una sola constancia, la versión suma uno", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { entorno, casos } = conBarrera(2, "obtener");
        try {
          const d = await nuevo("VERIFICADO");
          const version = (await filaDeDominio(dueno, d.id)).version;
          const rs = await Promise.all([
            casos.activarDominio(comoAdmin(), pedido(d.id, {})),
            casos.activarDominio(comoAdmin(), pedido(d.id, {})),
          ]);
          const ok = valores(rs);
          expect(errores(rs)).toEqual([]);
          expect(ok.map((v) => v.estado)).toEqual(["ACTIVO", "ACTIVO"]);
          expect(ok.filter((v) => !v.yaEstaba)).toHaveLength(1);
          expect(await auditoriaDeDominio(dueno, d.id)).toHaveLength(1);
          expect((await filaDeDominio(dueno, d.id)).version).toBe(version + 1);
        } finally {
          await entorno.cerrar();
        }
      }
    });

    it("N activar con la MISMA clave a la vez: todos ok, una sola transición y una sola constancia", async () => {
      const participantes = 4;
      const { entorno, casos } = conBarrera(participantes, "obtener");
      try {
        const d = await nuevo("VERIFICADO");
        const clave = claveAlAzar();
        const antes = await claves();
        const rs = await Promise.all(
          Array.from({ length: participantes }, () =>
            casos.activarDominio(comoAdmin(), pedido(d.id, { claveDeIdempotencia: clave })),
          ),
        );
        expect(errores(rs)).toEqual([]);
        expect(valores(rs).filter((v) => !v.yaEstaba)).toHaveLength(1);
        expect(await auditoriaDeDominio(dueno, d.id)).toHaveLength(1);
        expect(await claves()).toBe(antes + 1);
      } finally {
        await entorno.cerrar();
      }
    });

    it("retirar y activar el mismo dominio a la vez: queda retirado, nunca vuelve a activo, y las constancias dicen lo que pasó", async () => {
      let activacionGano = 0;
      let retiroGano = 0;
      for (let vuelta = 0; vuelta < VUELTAS * 2; vuelta++) {
        const { entorno, casos } = conBarrera(2, "obtener");
        try {
          const d = await nuevo("VERIFICADO");
          const [activar, retirar] = await Promise.all([
            casos.activarDominio(comoAdmin(), pedido(d.id, {})),
            casos.retirarDominio(comoAdmin(), pedido(d.id, { motivo: "baja" })),
          ]);
          // Si el retiro va primero, la activación se rechaza; si va después, el retiro encuentra el dominio activo.
          expect(retirar.ok).toBe(true);
          expect((await filaDeDominio(dueno, d.id)).estado).toBe("RETIRADO");
          const acciones = (await auditoriaDeDominio(dueno, d.id)).map((c) => c.accion);
          if (activar.ok) {
            activacionGano += 1;
            expect(acciones).toEqual(["DOMINIO_ACTIVADO", "DOMINIO_RETIRADO"]);
          } else {
            retiroGano += 1;
            expect(activar.error).toBe("DOMINIO_RETIRADO");
            expect(acciones).toEqual(["DOMINIO_RETIRADO"]);
          }
        } finally {
          await entorno.cerrar();
        }
      }
      expect(activacionGano + retiroGano).toBe(VUELTAS * 2);
    });

    it("dos retiros a la vez con motivos distintos: uno retira y el otro ve que ya estaba retirado; el motivo es el del ganador", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { entorno, casos } = conBarrera(2, "obtener");
        try {
          const d = await nuevo("ACTIVO");
          const rs = await Promise.all([
            casos.retirarDominio(comoAdmin(), pedido(d.id, { motivo: "motivo A" })),
            casos.retirarDominio(comoAdmin(), pedido(d.id, { motivo: "motivo B" })),
          ]);
          expect(errores(rs)).toEqual([]);
          expect(valores(rs).filter((v) => !v.yaEstaba)).toHaveLength(1);
          const constancias = await auditoriaDeDominio(dueno, d.id);
          expect(constancias).toHaveLength(1);
          expect((await filaDeDominio(dueno, d.id)).motivo).toBe(
            (constancias[0]?.despues as { motivo: string }).motivo,
          );
        } finally {
          await entorno.cerrar();
        }
      }
    });

    it("dos verificaciones del mismo dominio a la vez con fechas distintas: una fija la fecha, la otra ve que ya estaba verificado y no la pisa", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { entorno, casos } = conBarrera(2, "obtener");
        try {
          const d = await nuevo("PENDIENTE_VERIFICACION");
          const fechas = [VERIFICADO_EN, new Date(VERIFICADO_EN.getTime() + 60_000)];
          const rs = await Promise.all(
            fechas.map((verificadoEn) =>
              casos.verificarDominio(comoAdmin(), pedido(d.id, { verificadoEn })),
            ),
          );
          expect(errores(rs)).toEqual([]);
          expect(valores(rs).filter((v) => !v.yaEstaba)).toHaveLength(1);
          const constancias = await auditoriaDeDominio(dueno, d.id);
          expect(constancias).toHaveLength(1);
          const guardada = (await filaDeDominio(dueno, d.id)).verificado_en;
          expect(fechas.map((f) => f.toISOString())).toContain((guardada as Date).toISOString());
          expect((constancias[0]?.despues as { verificadoEn: string }).verificadoEn).toBe(
            (guardada as Date).toISOString(),
          );
        } finally {
          await entorno.cerrar();
        }
      }
    });

    it("desactivar y retirar a la vez: queda retirado y las constancias son coherentes con lo que cada uno vio", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { entorno, casos } = conBarrera(2, "obtener");
        try {
          const d = await nuevo("ACTIVO");
          const [desactivar, retirar] = await Promise.all([
            casos.desactivarDominio(comoAdmin(), pedido(d.id, {})),
            casos.retirarDominio(comoAdmin(), pedido(d.id, { motivo: "baja" })),
          ]);
          expect(retirar.ok).toBe(true);
          expect((await filaDeDominio(dueno, d.id)).estado).toBe("RETIRADO");
          const acciones = (await auditoriaDeDominio(dueno, d.id)).map((c) => c.accion);
          if (desactivar.ok && !desactivar.valor.yaEstaba) {
            expect(acciones).toEqual(["DOMINIO_DESACTIVADO", "DOMINIO_RETIRADO"]);
          } else {
            expect(desactivar.ok ? "ya estaba" : desactivar.error).toBe("DOMINIO_RETIRADO");
            expect(acciones).toEqual(["DOMINIO_RETIRADO"]);
          }
        } finally {
          await entorno.cerrar();
        }
      }
    });
  });
});

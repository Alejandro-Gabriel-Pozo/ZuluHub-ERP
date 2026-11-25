import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { inicioDelDiaArgentino } from "../../apps/plataforma/logica/fecha-de-verificacion";
import { SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import {
  comoAdminDePlataforma as comoAdmin,
  comoSoporteDePlataforma as comoSoporte,
  crearCasosDeDominios,
  crearEntornoDeDominios,
} from "./dominios-apoyo";
import { AHORA_DE_PRUEBA, crearBaseAparte } from "./entorno";
import { crearDominio, crearDominioDeEmpresa, crearMarca, hostAlAzar } from "./marcas-apoyo";
import { adminInexistente, claveAlAzar } from "./plataforma-apoyo";
import { crearConsultasDeSoporte, crearEntornoDeSoporte } from "./soporte-apoyo";
import { plataformaEn, sembrarEmpresa, sembrarTenant } from "./soporte-datos";

/**
 * La lista de dominios de las empresas (consola «Dominios», plan de dominio propio, P1) contra Postgres real: solo los dominios de EMPRESAS (nunca los de una marca), con la razón social de su
 * empresa, filtros por empresa y estado, páginas estables, el permiso (`dominios.ver`: ADMIN y SOPORTE; sin actor vigente, nada) y, sobre el caso de uso de alta, la idempotencia y la
 * concurrencia de un host de empresa y la fecha de verificación por día. Base propia.
 */

const base = inject("baseDePruebas");

function exito<T>(r: Resultado<T, unknown>): T {
  if (!r.ok) throw new Error(`tenía que salir bien: ${JSON.stringify(r.error)}`);
  return r.valor;
}

describe.skipIf(base === null)(
  "consola «Dominios»: la lista de los dominios de las empresas",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let consultas: ReturnType<typeof crearConsultasDeSoporte>;
    let entornoDeSoporte: ReturnType<typeof crearEntornoDeSoporte>;
    let entornoDeDominios: ReturnType<typeof crearEntornoDeDominios>;
    let casos: ReturnType<typeof crearCasosDeDominios>;
    let empresaA = "";
    let empresaB = "";
    let carta = { id: "", host: "" };
    let app = { id: "", host: "" };
    let deB = { id: "", host: "" };
    let deMarca = { id: "", host: "" };

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      entornoDeSoporte = crearEntornoDeSoporte(propia.base);
      consultas = crearConsultasDeSoporte(entornoDeSoporte);
      entornoDeDominios = crearEntornoDeDominios(propia.base, 6);
      casos = crearCasosDeDominios(entornoDeDominios);
      const tenant = await sembrarTenant(dueno);
      empresaA = await sembrarEmpresa(dueno, tenant, { razonSocial: "Hotel Ejemplo A" });
      empresaB = await sembrarEmpresa(dueno, tenant, { razonSocial: "Hotel Ejemplo B" });
      carta = await crearDominioDeEmpresa(dueno, empresaA, {
        superficie: "CARTA",
        estado: "ACTIVO",
      });
      app = await crearDominioDeEmpresa(dueno, empresaA, {
        superficie: "APP",
        estado: "PENDIENTE_VERIFICACION",
      });
      deB = await crearDominioDeEmpresa(dueno, empresaB, {
        superficie: "CARTA",
        estado: "VERIFICADO",
      });
      deMarca = await crearDominio(dueno, await crearMarca(dueno), { estado: "ACTIVO" });
    });
    afterAll(async () => {
      await dueno.end();
      await entornoDeSoporte.cerrar();
      await entornoDeDominios.cerrar();
      await propia.destruir();
    });

    it("devuelve solo los dominios de empresas, con la razón social, y nunca uno de una marca", async () => {
      const r = exito(await consultas.listarDominios(comoAdmin(), {}));
      const hosts = r.filas.map((f) => f.host);
      expect(hosts).toEqual(expect.arrayContaining([carta.host, app.host, deB.host]));
      expect(hosts).not.toContain(deMarca.host);
      const fila = r.filas.find((f) => f.host === carta.host);
      expect(fila).toMatchObject({
        razonSocial: "Hotel Ejemplo A",
        empresaId: empresaA,
        superficie: "CARTA",
        titular: "CLIENTE",
        estado: "ACTIVO",
      });
      expect(r.filas.map((f) => f.id)).toEqual([...r.filas.map((f) => f.id)].sort());
    });

    it("aislamiento: filtrada por una empresa, nunca aparece un dominio de la otra", async () => {
      const deA = exito(await consultas.listarDominios(comoAdmin(), { empresaId: empresaA }));
      expect(deA.filas.map((f) => f.host).sort()).toEqual([carta.host, app.host].sort());
      expect(deA.filas.every((f) => f.empresaId === empresaA)).toBe(true);
      const delB = exito(await consultas.listarDominios(comoAdmin(), { empresaId: empresaB }));
      expect(delB.filas.map((f) => f.host)).toEqual([deB.host]);
    });

    it("filtra por estado y rechaza un filtro que no existe en vez de devolver todo", async () => {
      const pendientes = exito(
        await consultas.listarDominios(comoAdmin(), { estado: "PENDIENTE_VERIFICACION" }),
      );
      expect(pendientes.filas.map((f) => f.host)).toContain(app.host);
      expect(pendientes.filas.every((f) => f.estado === "PENDIENTE_VERIFICACION")).toBe(true);
      expect(await consultas.listarDominios(comoAdmin(), { estado: "CUALQUIERA" })).toEqual({
        ok: false,
        error: "FILTRO_INVALIDO",
      });
      expect(await consultas.listarDominios(comoAdmin(), { empresaId: "no-es-un-uuid" })).toEqual({
        ok: false,
        error: "ID_INVALIDO",
      });
    });

    it("el filtro por id devuelve solo ese dominio y NUNCA uno de una marca (lista blanca de las acciones)", async () => {
      const propio = exito(await consultas.listarDominios(comoAdmin(), { dominioId: carta.id }));
      expect(propio.filas.map((f) => f.id)).toEqual([carta.id]);
      const deUnaMarca = exito(
        await consultas.listarDominios(comoAdmin(), { dominioId: deMarca.id }),
      );
      expect(deUnaMarca.filas).toEqual([]);
      const inexistente = exito(
        await consultas.listarDominios(comoAdmin(), {
          dominioId: "00000000-0000-4000-8000-000000000000",
        }),
      );
      expect(inexistente.filas).toEqual([]);
      expect(await consultas.listarDominios(comoAdmin(), { dominioId: "no-es-un-uuid" })).toEqual({
        ok: false,
        error: "ID_INVALIDO",
      });
    });

    it("pagina por id sin repetir ni saltear filas", async () => {
      const todas = exito(await consultas.listarDominios(comoAdmin(), { limite: 100 })).filas;
      const vistas: string[] = [];
      let despues: string | undefined;
      for (let vuelta = 0; vuelta < 10; vuelta++) {
        const pagina = exito(
          await consultas.listarDominios(comoAdmin(), {
            limite: 2,
            ...(despues === undefined ? {} : { despuesDeId: despues }),
          }),
        );
        vistas.push(...pagina.filas.map((f) => f.id));
        if (pagina.siguienteDespuesDeId === null) break;
        despues = pagina.siguienteDespuesDeId;
      }
      expect(vistas).toEqual(todas.map((f) => f.id));
    });

    it("SOPORTE ve la lista; sin actor vigente, nada (la base y el guard lo impiden)", async () => {
      const r = exito(await consultas.listarDominios(comoSoporte(), {}));
      expect(r.filas.length).toBeGreaterThanOrEqual(3);
      expect(SOPORTE_DE_PRUEBA).toBeDefined();
      for (const contexto of [
        plataformaEn(new Date(), { tipo: "ADMIN", id: adminInexistente() }),
        plataformaEn(new Date(), { tipo: "SISTEMA", proceso: "barrido" }),
      ]) {
        expect(await consultas.listarDominios(contexto, {})).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
      }
    });

    it("SOPORTE no cambia nada: agregar un dominio es SIN_PERMISO y no escribe", async () => {
      const antes = Number(
        ((await dueno.query("select count(*)::int as n from dominio")).rows[0] as { n: string }).n,
      );
      const r = await casos.agregarDominio(comoSoporte(), {
        claveDeIdempotencia: claveAlAzar(),
        host: hostAlAzar(),
        superficie: "APP",
        titular: "CLIENTE",
        esCanonico: false,
        duenio: { tipo: "EMPRESA", empresaId: empresaA },
      });
      expect(r).toEqual({ ok: false, error: "SIN_PERMISO" });
      const despues = Number(
        ((await dueno.query("select count(*)::int as n from dominio")).rows[0] as { n: string }).n,
      );
      expect(despues).toBe(antes);
    });

    it("idempotencia: el alta repetida con la misma clave no registra otro y sale en la lista una sola vez", async () => {
      const pedido = {
        claveDeIdempotencia: claveAlAzar(),
        host: hostAlAzar(),
        superficie: "CARTA" as const,
        titular: "CLIENTE" as const,
        esCanonico: false,
        duenio: { tipo: "EMPRESA" as const, empresaId: empresaA },
      };
      const primero = exito(await casos.agregarDominio(comoAdmin(), pedido));
      const segundo = exito(await casos.agregarDominio(comoAdmin(), pedido));
      expect(segundo.dominioId).toBe(primero.dominioId);
      expect(segundo.yaExistia).toBe(true);
      const lista = exito(
        await consultas.listarDominios(comoAdmin(), { empresaId: empresaA }),
      ).filas;
      expect(lista.filter((f) => f.host === pedido.host)).toHaveLength(1);
    });

    it("concurrencia: dos altas simultáneas del mismo host de empresa dejan una sola y la otra es HOST_DUPLICADO", async () => {
      const host = hostAlAzar();
      const alta = () =>
        casos.agregarDominio(comoAdmin(), {
          claveDeIdempotencia: claveAlAzar(),
          host,
          superficie: "APP",
          titular: "CLIENTE",
          esCanonico: false,
          duenio: { tipo: "EMPRESA", empresaId: empresaB },
        });
      const [a, b] = await Promise.all([alta(), alta()]);
      expect([a.ok, b.ok].sort()).toEqual([false, true]);
      const perdedora = a.ok ? b : a;
      expect(perdedora).toEqual({ ok: false, error: "HOST_DUPLICADO" });
      const lista = exito(
        await consultas.listarDominios(comoAdmin(), { empresaId: empresaB }),
      ).filas;
      expect(lista.filter((f) => f.host === host)).toHaveLength(1);
    });

    it("la verificación con fecha por día es idempotente: dos instantes del mismo día dan la misma fecha y la misma clave devuelve lo mismo", async () => {
      const { dominioId } = exito(
        await casos.agregarDominio(comoAdmin(), {
          claveDeIdempotencia: claveAlAzar(),
          host: hostAlAzar(),
          superficie: "APP",
          titular: "OPERADOR",
          esCanonico: false,
          duenio: { tipo: "EMPRESA", empresaId: empresaA },
        }),
      );
      const clave = claveAlAzar();
      // Dos instantes del mismo día argentino, ambos ya pasados para el reloj de la prueba.
      const inicio = inicioDelDiaArgentino(new Date(AHORA_DE_PRUEBA.getTime() - 2 * 86_400_000));
      const manana = new Date(inicio.getTime() + 3_600_000);
      const noche = new Date(inicio.getTime() + 23 * 3_600_000);
      expect(inicioDelDiaArgentino(manana).getTime()).toBe(inicioDelDiaArgentino(noche).getTime());
      const primera = exito(
        await casos.verificarDominio(comoAdmin(), {
          claveDeIdempotencia: clave,
          dominioId,
          verificadoEn: inicioDelDiaArgentino(manana),
        }),
      );
      const repetida = exito(
        await casos.verificarDominio(comoAdmin(), {
          claveDeIdempotencia: clave,
          dominioId,
          verificadoEn: inicioDelDiaArgentino(noche),
        }),
      );
      expect(primera.estado).toBe("VERIFICADO");
      expect(repetida).toMatchObject({ dominioId, estado: "VERIFICADO" });
      const filas = exito(
        await consultas.listarDominios(comoAdmin(), { estado: "VERIFICADO" }),
      ).filas;
      expect(filas.find((f) => f.id === dominioId)?.verificadoEn?.toISOString()).toBe(
        inicio.toISOString(),
      );
    });
  },
);

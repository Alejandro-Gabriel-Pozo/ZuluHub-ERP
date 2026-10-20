import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { ContextoDePlataforma as Contexto } from "../../src/contexto/contexto";
import type { CasosDeUsoDeDominios } from "../../src/plataforma/casos-de-uso/dominios";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import {
  auditoriaDeDominio,
  comoAdminDePlataforma as comoAdmin,
  comoAdministradorDe as comoAdminDe,
  comoElSistema as comoSistema,
  comoSoporteDePlataforma as comoSoporte,
  crearCasosDeDominios,
  crearEntornoDeDominios,
  crearRegistroDeReferencias,
  filaDeDominio,
  huellaDeEscrituras,
  type TxDeDominiosDePrueba,
} from "./dominios-apoyo";
import { comoEmpresa, crearBaseAparte } from "./entorno";
import { crearMarca, crearMundoDeMarca, hostAlAzar, marcaPrincipal } from "./marcas-apoyo";
import { adminInexistente, claveAlAzar, crearAdminDeBase } from "./plataforma-apoyo";
import { personaId } from "../../src/primitivas/identificadores/marca";

/**
 * Casos de uso de dominios de plataforma contra Postgres real (M4a): el ciclo completo, la auditoría exacta
 * (quién, cuándo, qué cambió), la idempotencia en serie, la autorización, la atomicidad y las reglas de
 * negocio de punta a punta. La concurrencia está en `dominios-concurrencia.test.ts` y la traducción de las
 * restricciones en `dominios-persistencia.test.ts`. Base propia.
 */

const base = inject("baseDePruebas");
const VERIFICADO_EN = new Date("2026-10-11T11:00:00.000Z");

function exito<T>(r: Resultado<T, unknown>): T {
  if (!r.ok) throw new Error(`tenía que salir bien: ${JSON.stringify(r.error)}`);
  return r.valor;
}
const falla = <T>(r: Resultado<T, unknown>) => {
  if (r.ok) throw new Error("tenía que fallar");
  return r.error;
};

describe.skipIf(base === null)("dominios de plataforma: casos de uso contra Postgres", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeDominiosDePrueba>;
  let casos: CasosDeUsoDeDominios;
  let principal: string;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeDominios(propia.base, 6);
    casos = crearCasosDeDominios(entorno);
    principal = await marcaPrincipal(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const alta = (
    extra: Partial<Parameters<CasosDeUsoDeDominios["agregarDominio"]>[1]> = {},
    contexto: Contexto = comoAdmin(),
  ) =>
    casos.agregarDominio(contexto, {
      claveDeIdempotencia: claveAlAzar(),
      host: hostAlAzar(),
      superficie: "APP",
      titular: "OPERADOR",
      esCanonico: false,
      duenio: { tipo: "MARCA", marcaId: principal },
      ...extra,
    });
  const sobre = <T extends object = object>(dominioId: string, extra?: T) => ({
    claveDeIdempotencia: claveAlAzar(),
    dominioId,
    ...extra,
  });
  const verificar = (id: string, extra: object = {}, contexto: Contexto = comoAdmin()) =>
    casos.verificarDominio(contexto, {
      ...sobre(id),
      verificadoEn: VERIFICADO_EN,
      ...extra,
    });
  const activar = (id: string, extra: object = {}) =>
    casos.activarDominio(comoAdmin(), { ...sobre(id), ...extra });
  const desactivar = (id: string, extra: object = {}) =>
    casos.desactivarDominio(comoAdmin(), { ...sobre(id), ...extra });
  const retirar = (id: string, motivo = "se fue el cliente", extra: object = {}) =>
    casos.retirarDominio(comoAdmin(), { ...sobre(id), motivo, ...extra });

  /** Un dominio nuevo de una marca nueva, agregado por el caso de uso. */
  async function unDominio(extra: Partial<Parameters<typeof alta>[0]> = {}) {
    const marca = await crearMarca(dueno);
    const host = hostAlAzar();
    const { dominioId } = exito(
      await alta({ host, duenio: { tipo: "MARCA", marcaId: marca }, ...extra }),
    );
    return { id: dominioId as string, marca, host };
  }
  const enResolucion = async (host: string) =>
    (await dueno.query("select 1 from resolucion_de_host where host = $1", [host])).rowCount;

  describe("el ciclo de vida de punta a punta", () => {
    it("agregar, verificar, activar, desactivar, volver a verificar, activar y retirar: cada paso en su estado, y solo ACTIVO se resuelve", async () => {
      const { id, host } = await unDominio();
      expect(await filaDeDominio(dueno, id)).toMatchObject({
        host,
        estado: "PENDIENTE_VERIFICACION",
        verificado_en: null,
        registrado_por: ADMIN_DE_PRUEBA,
        version: 1,
      });
      expect(await enResolucion(host)).toBe(0);

      expect(exito(await verificar(id))).toEqual({
        dominioId: id,
        estado: "VERIFICADO",
        yaEstaba: false,
      });
      expect(await filaDeDominio(dueno, id)).toMatchObject({
        estado: "VERIFICADO",
        verificado_en: VERIFICADO_EN,
        version: 2,
      });
      expect(await enResolucion(host)).toBe(0);

      expect(exito(await activar(id)).estado).toBe("ACTIVO");
      expect(await filaDeDominio(dueno, id)).toMatchObject({
        estado: "ACTIVO",
        verificado_en: VERIFICADO_EN,
        version: 3,
      });
      expect(await enResolucion(host)).toBe(1);

      // La desactivación vuelve a la página neutra al instante y borra la fecha de verificación.
      expect(exito(await desactivar(id)).estado).toBe("PENDIENTE_VERIFICACION");
      expect(await filaDeDominio(dueno, id)).toMatchObject({
        estado: "PENDIENTE_VERIFICACION",
        verificado_en: null,
        version: 4,
      });
      expect(await enResolucion(host)).toBe(0);

      // Sin nueva verificación no se activa.
      expect(falla(await activar(id))).toBe("DOMINIO_SIN_VERIFICAR");
      const otraFecha = new Date("2026-10-11T11:30:00.000Z");
      exito(await verificar(id, { verificadoEn: otraFecha }));
      exito(await activar(id));
      expect(await enResolucion(host)).toBe(1);
      expect((await filaDeDominio(dueno, id)).verificado_en).toEqual(otraFecha);

      // El retiro también vuelve a la página neutra al instante.
      expect(exito(await retirar(id, "  baja del cliente  ")).estado).toBe("RETIRADO");
      expect(await filaDeDominio(dueno, id)).toMatchObject({
        estado: "RETIRADO",
        motivo: "baja del cliente",
        version: 7,
      });
      expect(await enResolucion(host)).toBe(0);

      // Retirado es terminal: ningún cambio lo toca.
      for (const r of [await verificar(id), await activar(id), await desactivar(id)]) {
        expect(falla(r)).toBe("DOMINIO_RETIRADO");
      }
      expect((await filaDeDominio(dueno, id)).version).toBe(7);
    });

    it("un host retirado puede volver a registrarse, como un dominio nuevo; el viejo queda retirado", async () => {
      const { id, host } = await unDominio();
      exito(await retirar(id));
      const otro = exito(
        await alta({ host, duenio: { tipo: "MARCA", marcaId: principal }, superficie: "CARTA" }),
      );
      expect(otro.dominioId).not.toBe(id);
      expect(otro.yaExistia).toBe(false);
      expect((await filaDeDominio(dueno, id)).estado).toBe("RETIRADO");
      expect((await filaDeDominio(dueno, otro.dominioId)).estado).toBe("PENDIENTE_VERIFICACION");
      // y ahora el nuevo ocupa el host
      expect(falla(await alta({ host }))).toBe("HOST_DUPLICADO");
    });

    it("el host se guarda normalizado: mayúsculas, puerto y punto final no crean otro host", async () => {
      const host = hostAlAzar();
      const { dominioId } = exito(await alta({ host: `${host.toUpperCase()}.:8080` }));
      expect((await filaDeDominio(dueno, dominioId)).host).toBe(host);
      expect(falla(await alta({ host }))).toBe("HOST_DUPLICADO");
    });

    it("el dominio canónico: uno por marca y superficie, no se retira, sí se desactiva", async () => {
      const marca = await crearMarca(dueno);
      const duenio = { tipo: "MARCA", marcaId: marca } as const;
      const canonico = exito(await alta({ duenio, esCanonico: true, superficie: "APP" }));
      expect(falla(await alta({ duenio, esCanonico: true, superficie: "APP" }))).toBe(
        "YA_TIENE_CANONICO",
      );
      // otra superficie de la misma marca: sí
      exito(await alta({ duenio, esCanonico: true, superficie: "CARTA" }));
      const huella = await huellaDeEscrituras(dueno);
      expect(falla(await retirar(canonico.dominioId))).toBe("DOMINIO_CANONICO");
      expect(await huellaDeEscrituras(dueno)).toEqual(huella);
      exito(await verificar(canonico.dominioId));
      exito(await activar(canonico.dominioId));
      expect(falla(await retirar(canonico.dominioId))).toBe("DOMINIO_CANONICO");
      expect(exito(await desactivar(canonico.dominioId)).estado).toBe("PENDIENTE_VERIFICACION");
      // uno retirado no cuenta: un alias de la misma marca se retira y otro canónico sigue sin poder
      const alias = exito(await alta({ duenio, superficie: "APP" }));
      exito(await retirar(alias.dominioId));
    });

    it("un host de empresa: de su aplicación o su carta, con la marca del tenant; no existe la empresa o la marca, o está retirada, se rechaza", async () => {
      const otra = await crearMarca(dueno);
      const mundo = await crearMundoDeMarca(dueno, { marca: otra });
      const host = hostAlAzar();
      const { dominioId } = exito(
        await alta({
          host,
          superficie: "CARTA",
          titular: "CLIENTE",
          duenio: { tipo: "EMPRESA", empresaId: mundo.empresa },
        }),
      );
      expect(await filaDeDominio(dueno, dominioId)).toMatchObject({
        duenio_empresa_id: mundo.empresa,
        duenio_marca_id: null,
        marca_id: otra,
        titular: "CLIENTE",
        es_canonico: false,
      });
      const inexistente = "00000000-0000-4000-8000-0000000000ff";
      expect(falla(await alta({ duenio: { tipo: "EMPRESA", empresaId: inexistente } }))).toBe(
        "EMPRESA_NO_ENCONTRADA",
      );
      expect(falla(await alta({ duenio: { tipo: "MARCA", marcaId: inexistente } }))).toBe(
        "MARCA_NO_ENCONTRADA",
      );
      await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [otra]);
      expect(falla(await alta({ duenio: { tipo: "MARCA", marcaId: otra } }))).toBe(
        "MARCA_RETIRADA",
      );
      expect(falla(await alta({ duenio: { tipo: "EMPRESA", empresaId: mundo.empresa } }))).toBe(
        "MARCA_RETIRADA",
      );
    });

    it("la forma del pedido se rechaza con su nombre y sin escribir nada", async () => {
      const marca = await crearMarca(dueno);
      const antes = await huellaDeEscrituras(dueno);
      const duenio = { tipo: "MARCA", marcaId: marca } as const;
      expect(falla(await alta({ host: "https://x.com" }))).toBe("HOST_INVALIDO");
      expect(falla(await alta({ superficie: "TIENDA" }))).toBe("SUPERFICIE_INVALIDA");
      expect(falla(await alta({ titular: "YO" }))).toBe("TITULAR_INVALIDO");
      expect(falla(await alta({ duenio: { tipo: "MARCA", marcaId: "no-es-un-uuid" } }))).toBe(
        "ID_INVALIDO",
      );
      expect(
        falla(await alta({ duenio: { tipo: "EMPRESA", empresaId: marca }, superficie: "LANDING" })),
      ).toBe("SUPERFICIE_NO_ADMITIDA_PARA_EMPRESA");
      expect(
        falla(await alta({ duenio: { tipo: "EMPRESA", empresaId: marca }, esCanonico: true })),
      ).toBe("CANONICO_SOLO_DE_MARCA");
      expect(falla(await alta({ duenio, claveDeIdempotencia: "corta" }))).toBe(
        "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
      );
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("un dominio que no existe, un id mal formado, una fecha futura: errores con nombre", async () => {
      const { id } = await unDominio();
      const noExiste = "00000000-0000-4000-8000-0000000000fe";
      const antes = await huellaDeEscrituras(dueno);
      for (const r of [
        await verificar(noExiste),
        await activar(noExiste),
        await desactivar(noExiste),
        await retirar(noExiste),
      ]) {
        expect(falla(r)).toBe("DOMINIO_NO_ENCONTRADO");
      }
      expect(falla(await verificar("x"))).toBe("ID_INVALIDO");
      expect(
        falla(await verificar(id, { verificadoEn: new Date("2026-10-11T13:00:00.000Z") })),
      ).toBe("FECHA_DE_VERIFICACION_INVALIDA");
      expect(falla(await verificar(id, { verificadoEn: new Date("no") }))).toBe(
        "FECHA_DE_VERIFICACION_INVALIDA",
      );
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      expect((await filaDeDominio(dueno, id)).estado).toBe("PENDIENTE_VERIFICACION");
    });
  });

  describe("retirar exige motivo", () => {
    it("sin motivo, con espacios o demasiado largo se rechaza y el dominio sigue como estaba", async () => {
      const { id } = await unDominio();
      exito(await verificar(id));
      exito(await activar(id));
      const antes = await huellaDeEscrituras(dueno);
      for (const motivo of ["", " ", "   ", "\n\t "]) {
        expect(falla(await retirar(id, motivo)), JSON.stringify(motivo)).toBe("MOTIVO_OBLIGATORIO");
      }
      expect(falla(await retirar(id, "m".repeat(501)))).toBe("MOTIVO_DEMASIADO_LARGO");
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      expect((await filaDeDominio(dueno, id)).estado).toBe("ACTIVO");
      // justo en el tope pasa
      exito(await retirar(id, "m".repeat(500)));
      expect((await filaDeDominio(dueno, id)).motivo).toBe("m".repeat(500));
    });

    it("el motivo del retiro queda en la fila y en la constancia", async () => {
      const { id } = await unDominio();
      exito(await retirar(id, "  contrato terminado  "));
      expect((await filaDeDominio(dueno, id)).motivo).toBe("contrato terminado");
      const constancias = await auditoriaDeDominio(dueno, id);
      expect(constancias.at(-1)).toMatchObject({
        accion: "DOMINIO_RETIRADO",
        despues: { estado: "RETIRADO", motivo: "contrato terminado" },
      });
    });
  });

  describe("auditoría de plataforma: quién, cuándo y qué cambió, en la misma transacción", () => {
    it("cada cambio real deja UNA constancia con el actor del contexto, la hora de la base y el antes y el después", async () => {
      const otroAdmin = await crearAdminDeBase(dueno, { rol: "ADMIN" });
      const marca = await crearMarca(dueno);
      const host = hostAlAzar();
      const desde = (await dueno.query<{ t: Date }>("select clock_timestamp() as t")).rows[0]?.t;
      const creado = exito(
        await alta(
          {
            host,
            duenio: { tipo: "MARCA", marcaId: marca },
            superficie: "CARTA",
            titular: "CLIENTE",
          },
          comoAdminDe(otroAdmin.id),
        ),
      );
      const id = creado.dominioId as string;
      expect((await filaDeDominio(dueno, id)).registrado_por).toBe(otroAdmin.id);
      exito(await verificar(id, {}, comoAdmin()));
      exito(await casos.activarDominio(comoAdminDe(otroAdmin.id), sobre(id)));
      exito(await desactivar(id));
      exito(await retirar(id, "fin"));
      const hasta = (await dueno.query<{ t: Date }>("select clock_timestamp() as t")).rows[0]?.t;

      const constancias = await auditoriaDeDominio(dueno, id);
      expect(constancias.map((c) => [c.accion, c.actor])).toEqual([
        ["DOMINIO_AGREGADO", otroAdmin.id],
        ["DOMINIO_VERIFICADO", ADMIN_DE_PRUEBA],
        ["DOMINIO_ACTIVADO", otroAdmin.id],
        ["DOMINIO_DESACTIVADO", ADMIN_DE_PRUEBA],
        ["DOMINIO_RETIRADO", ADMIN_DE_PRUEBA],
      ]);
      for (const c of constancias) {
        expect(c.entidad).toBe("dominio");
        expect(c.entidad_id).toBe(id);
        expect(c.creado_en.getTime()).toBeGreaterThanOrEqual((desde as Date).getTime());
        expect(c.creado_en.getTime()).toBeLessThanOrEqual((hasta as Date).getTime());
      }
      const base0 = { host, superficie: "CARTA" };
      expect(constancias.map((c) => [c.antes, c.despues])).toEqual([
        [
          null,
          {
            ...base0,
            estado: "PENDIENTE_VERIFICACION",
            verificadoEn: null,
            motivo: null,
            titular: "CLIENTE",
            esCanonico: false,
            duenioTipo: "MARCA",
            duenioId: marca,
            marcaId: marca,
          },
        ],
        [
          { ...base0, estado: "PENDIENTE_VERIFICACION", verificadoEn: null, motivo: null },
          {
            ...base0,
            estado: "VERIFICADO",
            verificadoEn: VERIFICADO_EN.toISOString(),
            motivo: null,
          },
        ],
        [
          {
            ...base0,
            estado: "VERIFICADO",
            verificadoEn: VERIFICADO_EN.toISOString(),
            motivo: null,
          },
          { ...base0, estado: "ACTIVO", verificadoEn: VERIFICADO_EN.toISOString(), motivo: null },
        ],
        [
          { ...base0, estado: "ACTIVO", verificadoEn: VERIFICADO_EN.toISOString(), motivo: null },
          { ...base0, estado: "PENDIENTE_VERIFICACION", verificadoEn: null, motivo: null },
        ],
        [
          { ...base0, estado: "PENDIENTE_VERIFICACION", verificadoEn: null, motivo: null },
          { ...base0, estado: "RETIRADO", verificadoEn: null, motivo: "fin" },
        ],
      ]);
    });

    it("lo que ya estaba así no audita; lo rechazado no audita; la constancia nunca lleva el motivo del rechazo", async () => {
      const { id } = await unDominio();
      exito(await verificar(id));
      const antes = (await auditoriaDeDominio(dueno, id)).length;
      exito(await verificar(id)); // otra clave, ya verificado
      exito(await desactivar(id));
      exito(await desactivar(id)); // ya pendiente
      falla(await retirar(id, ""));
      expect((await auditoriaDeDominio(dueno, id)).length).toBe(antes + 1);
    });
  });

  describe("idempotencia", () => {
    it("agregar con la misma clave: el mismo dominio con yaExistia, sin segunda fila ni segunda constancia ni segunda clave", async () => {
      const marca = await crearMarca(dueno);
      const entrada = {
        claveDeIdempotencia: claveAlAzar(),
        host: hostAlAzar(),
        superficie: "APP",
        titular: "OPERADOR",
        esCanonico: false,
        duenio: { tipo: "MARCA", marcaId: marca },
      } as const;
      const antes = await huellaDeEscrituras(dueno);
      const primero = exito(await casos.agregarDominio(comoAdmin(), entrada));
      const segundo = exito(
        await casos.agregarDominio(comoAdmin(), { ...entrada, host: entrada.host.toUpperCase() }),
      );
      expect(primero.yaExistia).toBe(false);
      expect(segundo).toEqual({ dominioId: primero.dominioId, yaExistia: true });
      expect(await huellaDeEscrituras(dueno)).toEqual({
        ...antes,
        dominios: antes.dominios + 1,
        auditoria: antes.auditoria + 1,
        claves: antes.claves + 1,
      });
    });

    it("la misma clave con otra entrada es CLAVE_REUTILIZADA, también si cambia la operación, y no escribe", async () => {
      const marca = await crearMarca(dueno);
      const clave = claveAlAzar();
      const duenio = { tipo: "MARCA", marcaId: marca } as const;
      const primero = exito(await alta({ claveDeIdempotencia: clave, duenio }));
      const antes = await huellaDeEscrituras(dueno);
      expect(falla(await alta({ claveDeIdempotencia: clave, duenio, superficie: "CARTA" }))).toBe(
        "CLAVE_REUTILIZADA",
      );
      expect(falla(await alta({ claveDeIdempotencia: clave, duenio, titular: "CLIENTE" }))).toBe(
        "CLAVE_REUTILIZADA",
      );
      expect(falla(await alta({ claveDeIdempotencia: clave, duenio, esCanonico: true }))).toBe(
        "CLAVE_REUTILIZADA",
      );
      // la misma clave para otra operación
      expect(falla(await verificar(primero.dominioId, { claveDeIdempotencia: clave }))).toBe(
        "CLAVE_REUTILIZADA",
      );
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("verificar, activar, desactivar y retirar con la misma clave: el mismo resultado marcado yaEstaba, sin segunda constancia", async () => {
      const { id } = await unDominio();
      const pasos: Array<[string, (clave: string) => Promise<Resultado<unknown, unknown>>]> = [
        ["verificar", (c) => verificar(id, { claveDeIdempotencia: c })],
        ["activar", (c) => activar(id, { claveDeIdempotencia: c })],
        ["desactivar", (c) => desactivar(id, { claveDeIdempotencia: c })],
        ["retirar", (c) => retirar(id, "fin", { claveDeIdempotencia: c })],
      ];
      for (const [nombre, paso] of pasos) {
        const clave = claveAlAzar();
        const antes = await huellaDeEscrituras(dueno);
        const primero = exito(await paso(clave)) as { yaEstaba: boolean; dominioId: string };
        const version = (await filaDeDominio(dueno, id)).version;
        const segundo = exito(await paso(clave)) as { yaEstaba: boolean; dominioId: string };
        expect(primero.yaEstaba, nombre).toBe(false);
        expect(segundo, nombre).toEqual({ ...primero, yaEstaba: true });
        expect((await filaDeDominio(dueno, id)).version, nombre).toBe(version);
        const despues = await huellaDeEscrituras(dueno);
        expect(despues.auditoria, nombre).toBe(antes.auditoria + 1);
        expect(despues.claves, nombre).toBe(antes.claves + 1);
      }
    });

    it("la misma clave con otro dominio, otra fecha o otro motivo es CLAVE_REUTILIZADA", async () => {
      const a = await unDominio();
      const b = await unDominio();
      const clave = claveAlAzar();
      exito(await verificar(a.id, { claveDeIdempotencia: clave }));
      expect(falla(await verificar(b.id, { claveDeIdempotencia: clave }))).toBe(
        "CLAVE_REUTILIZADA",
      );
      expect(
        falla(
          await verificar(a.id, {
            claveDeIdempotencia: clave,
            verificadoEn: new Date("2026-10-11T11:00:00.001Z"),
          }),
        ),
      ).toBe("CLAVE_REUTILIZADA");
      const clave2 = claveAlAzar();
      exito(await retirar(b.id, "motivo uno", { claveDeIdempotencia: clave2 }));
      expect(falla(await retirar(b.id, "motivo dos", { claveDeIdempotencia: clave2 }))).toBe(
        "CLAVE_REUTILIZADA",
      );
    });

    it("lo que ya estaba (activar lo activo, retirar lo retirado) es éxito con otra clave: sin constancia, y la clave queda guardada", async () => {
      const { id } = await unDominio();
      exito(await verificar(id));
      exito(await activar(id));
      const antes = await huellaDeEscrituras(dueno);
      const version = (await filaDeDominio(dueno, id)).version;
      expect(exito(await activar(id))).toEqual({ dominioId: id, estado: "ACTIVO", yaEstaba: true });
      expect((await filaDeDominio(dueno, id)).version).toBe(version);
      exito(await retirar(id));
      expect(exito(await retirar(id, "otro motivo"))).toEqual({
        dominioId: id,
        estado: "RETIRADO",
        yaEstaba: true,
      });
      expect((await filaDeDominio(dueno, id)).motivo).toBe("se fue el cliente");
      const despues = await huellaDeEscrituras(dueno);
      expect(despues.auditoria).toBe(antes.auditoria + 1); // solo el retiro real
      expect(despues.claves).toBe(antes.claves + 3);
    });

    it("las claves son por administrador: la misma clave de otro administrador no choca ni se confunde", async () => {
      const otroAdmin = await crearAdminDeBase(dueno, { rol: "ADMIN" });
      const { id } = await unDominio();
      const clave = claveAlAzar();
      exito(await verificar(id, { claveDeIdempotencia: clave }));
      // el otro administrador usa la misma clave para OTRO pedido y nadie le dice que está reutilizada
      const suya = exito(
        await casos.retirarDominio(comoAdminDe(otroAdmin.id), {
          claveDeIdempotencia: clave,
          dominioId: id,
          motivo: "lo retira el otro",
        }),
      );
      expect(suya.yaEstaba).toBe(false);
      const { rows } = await dueno.query(
        "select admin_id from idempotencia_plataforma where clave = $1 order by admin_id",
        [clave],
      );
      expect(rows).toHaveLength(2);
    });
  });

  describe("autorización: quién llega y quién no", () => {
    type Llamada = [
      caso: string,
      accion: string,
      llamar: (c: Contexto) => Promise<Resultado<unknown, unknown>>,
    ];
    const llamadas = (id: string): Llamada[] => [
      ["agregarDominio", "dominios.agregar", (c) => alta({}, c)],
      ["verificarDominio", "dominios.verificar", (c) => verificar(id, {}, c)],
      ["activarDominio", "dominios.activar", (c) => casos.activarDominio(c, sobre(id))],
      ["desactivarDominio", "dominios.desactivar", (c) => casos.desactivarDominio(c, sobre(id))],
      [
        "retirarDominio",
        "dominios.retirar",
        (c) => casos.retirarDominio(c, { ...sobre(id), motivo: "x" }),
      ],
    ];

    it("SOPORTE, un administrador de baja, uno inexistente y el sistema reciben SIN_PERMISO en cada caso y no dejan nada", async () => {
      const { id } = await unDominio();
      const deBaja = await crearAdminDeBase(dueno, { rol: "ADMIN", activo: false });
      const actores: Array<[string, Contexto]> = [
        ["SOPORTE", comoSoporte()],
        ["ADMIN de baja", comoAdminDe(deBaja.id)],
        ["administrador inexistente", comoAdminDe(adminInexistente())],
        ["sistema", comoSistema()],
      ];
      for (const [nombre, contexto] of actores) {
        for (const [caso, , llamar] of llamadas(id)) {
          const antes = await huellaDeEscrituras(dueno);
          expect(await llamar(contexto), `${nombre} ${caso}`).toEqual({
            ok: false,
            error: "SIN_PERMISO",
          });
          expect(await huellaDeEscrituras(dueno), `${nombre} ${caso}`).toEqual(antes);
        }
      }
      expect((await filaDeDominio(dueno, id)).estado).toBe("PENDIENTE_VERIFICACION");
    });

    it("el rechazo deja una referencia de error que soporte puede buscar, sin ningún dato del dominio", async () => {
      const { id } = await unDominio();
      const registrar = crearRegistroDeReferencias(entorno);
      for (const [caso, accion, llamar] of llamadas(id)) {
        const r = await llamar(comoSoporte());
        expect(r, caso).toEqual({ ok: false, error: "SIN_PERMISO" });
        // Lo que hace la puerta después del rechazo: registrar la referencia con el contexto de quien actuó.
        const referencia = exito(
          await registrar(comoSoporte(), {
            accion,
            motivo: "SIN_PERMISO",
            empresaId: null,
            personaId: null,
          }),
        );
        expect(referencia).toMatch(/^PD-[0-9A-F]{4}-[0-9A-F]{4}$/);
        const { rows } = await dueno.query<{ accion: string; motivo: string }>(
          "select accion, motivo from referencia_de_error where referencia = $1",
          [referencia],
        );
        expect(rows).toEqual([{ accion, motivo: "SIN_PERMISO" }]);
      }
    });

    it("dar de baja a un administrador corta su acceso en la operación siguiente (nada en caché)", async () => {
      const temporal = await crearAdminDeBase(dueno, { rol: "ADMIN" });
      const contexto = comoAdminDe(temporal.id);
      exito(await alta({}, contexto));
      await dueno.query("update admin_plataforma set activo = false where id = $1", [temporal.id]);
      const antes = await huellaDeEscrituras(dueno);
      expect(falla(await alta({}, contexto))).toBe("SIN_PERMISO");
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("un administrador cuyo rol baja de ADMIN a SOPORTE pierde la escritura en la operación siguiente", async () => {
      const temporal = await crearAdminDeBase(dueno, { rol: "ADMIN" });
      const contexto = comoAdminDe(temporal.id);
      exito(await alta({}, contexto));
      await dueno.query("update admin_plataforma set rol = 'SOPORTE' where id = $1", [temporal.id]);
      expect(falla(await alta({}, contexto))).toBe("SIN_PERMISO");
    });

    it("un actor de empresa nunca llega: el contexto de empresa lanza antes de abrir ninguna transacción y no deja nada", async () => {
      const marca = await crearMarca(dueno);
      const mundo = await crearMundoDeMarca(dueno, { marca });
      const { id } = await unDominio();
      // Solo se llega acá saltándose el tipo (una llamada sin tipar): por eso el cast.
      const empresa = comoEmpresa(
        mundo.empresa as never,
        personaId(mundo.persona),
      ) as unknown as Contexto;
      for (const [caso, , llamar] of llamadas(id)) {
        const antes = await huellaDeEscrituras(dueno);
        await expect(llamar(empresa), caso).rejects.toThrow(/no es de plataforma/);
        expect(await huellaDeEscrituras(dueno), caso).toEqual(antes);
      }
    });

    it("el ADMIN de las pruebas y el SOPORTE son los que dice la base (control de la matriz)", async () => {
      const { rows } = await dueno.query<{ id: string; rol: string }>(
        "select id, rol from admin_plataforma where id in ($1, $2) order by rol",
        [ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA],
      );
      expect(rows.map((f) => f.rol)).toEqual(["ADMIN", "SOPORTE"]);
    });
  });

  describe("atomicidad: una falla en cualquier paso no deja nada", () => {
    type Paso = "dominios.crear" | "dominios.cambiarEstado" | "auditoria" | "idempotencia";

    /** Un entorno cuya transacción lanza justo DESPUÉS de ese paso (el cambio ya se hizo dentro de ella). */
    function conFallaDespuesDe(paso: Paso) {
      const falla = () => new Error(`falla provocada después de ${paso}`);
      const propio = crearEntornoDeDominios(propia.base, 2, (tx) => ({
        ...tx,
        dominios: {
          ...tx.dominios,
          crear: async (...a) => {
            const r = await tx.dominios.crear(...a);
            if (paso === "dominios.crear") throw falla();
            return r;
          },
          cambiarEstado: async (...a) => {
            const r = await tx.dominios.cambiarEstado(...a);
            if (paso === "dominios.cambiarEstado") throw falla();
            return r;
          },
        },
        auditoriaDePlataforma: {
          registrar: async (...a) => {
            await tx.auditoriaDePlataforma.registrar(...a);
            if (paso === "auditoria") throw falla();
          },
        },
        idempotencia: {
          ...tx.idempotencia,
          registrar: async (...a) => {
            await tx.idempotencia.registrar(...a);
            if (paso === "idempotencia") throw falla();
          },
        },
      }));
      return { entorno: propio, casos: crearCasosDeDominios(propio) };
    }

    const pasosDeAgregar: Paso[] = ["dominios.crear", "auditoria", "idempotencia"];
    for (const paso of pasosDeAgregar) {
      it(`agregar: si falla después de «${paso}» no queda ni el dominio, ni la constancia, ni la clave`, async () => {
        const { entorno: propio, casos: c } = conFallaDespuesDe(paso);
        try {
          const antes = await huellaDeEscrituras(dueno);
          const host = hostAlAzar();
          const clave = claveAlAzar();
          const entrada = {
            claveDeIdempotencia: clave,
            host,
            superficie: "APP",
            titular: "OPERADOR",
            esCanonico: false,
            duenio: { tipo: "MARCA", marcaId: principal },
          } as const;
          await expect(c.agregarDominio(comoAdmin(), entrada)).rejects.toThrow(/falla provocada/);
          expect(await huellaDeEscrituras(dueno)).toEqual(antes);
          // y el mismo pedido, sin falla, sale bien (la clave no quedó tomada)
          exito(await casos.agregarDominio(comoAdmin(), entrada));
        } finally {
          await propio.cerrar();
        }
      });
    }

    const pasosDeCambio: Paso[] = ["dominios.cambiarEstado", "auditoria", "idempotencia"];
    for (const paso of pasosDeCambio) {
      it(`verificar: si falla después de «${paso}» el dominio sigue pendiente y no queda constancia ni clave`, async () => {
        const { entorno: propio, casos: c } = conFallaDespuesDe(paso);
        try {
          const { id } = await unDominio();
          const antes = await huellaDeEscrituras(dueno);
          const entrada = { ...sobre(id), verificadoEn: VERIFICADO_EN };
          await expect(c.verificarDominio(comoAdmin(), entrada)).rejects.toThrow(/falla provocada/);
          expect(await huellaDeEscrituras(dueno)).toEqual(antes);
          expect(await filaDeDominio(dueno, id)).toMatchObject({
            estado: "PENDIENTE_VERIFICACION",
            verificado_en: null,
            version: 1,
          });
          exito(await casos.verificarDominio(comoAdmin(), entrada));
        } finally {
          await propio.cerrar();
        }
      });
    }

    it("retirar: si falla después de la constancia el dominio sigue activo", async () => {
      const { entorno: propio, casos: c } = conFallaDespuesDe("auditoria");
      try {
        const { id } = await unDominio();
        exito(await verificar(id));
        exito(await activar(id));
        const antes = await huellaDeEscrituras(dueno);
        await expect(c.retirarDominio(comoAdmin(), { ...sobre(id), motivo: "x" })).rejects.toThrow(
          /falla provocada/,
        );
        expect(await huellaDeEscrituras(dueno)).toEqual(antes);
        expect((await filaDeDominio(dueno, id)).estado).toBe("ACTIVO");
      } finally {
        await propio.cerrar();
      }
    });

    it("una constancia que la base rechaza (acción desconocida o secreto en los datos) tampoco deja el cambio", async () => {
      const propio = crearEntornoDeDominios(propia.base, 2, (tx) => ({
        ...tx,
        auditoriaDePlataforma: {
          registrar: (r) => tx.auditoriaDePlataforma.registrar({ ...r, despues: { token: "x" } }),
        },
      }));
      try {
        const antes = await huellaDeEscrituras(dueno);
        await expect(
          crearCasosDeDominios(propio).agregarDominio(comoAdmin(), {
            claveDeIdempotencia: claveAlAzar(),
            host: hostAlAzar(),
            superficie: "APP",
            titular: "OPERADOR",
            esCanonico: false,
            duenio: { tipo: "MARCA", marcaId: principal },
          }),
        ).rejects.toThrow(/parece un secreto/);
        expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      } finally {
        await propio.cerrar();
      }
    });
  });
});

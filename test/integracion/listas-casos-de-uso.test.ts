import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import type { CasosDeUsoDeListas } from "../../src/plataforma/casos-de-uso/listas-del-sistema";
import type { ConsultasDeListas } from "../../src/plataforma/consultas/consultas-de-listas";
import { ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import { crearBaseAparte } from "./entorno";
import {
  crearCasosDeListas,
  crearConsultasDeListasDePrueba,
  crearEntornoDeListas,
  huellaDeListas,
  valorPorNombre,
  valoresGuardados,
  type TxDeListasDePrueba,
} from "./listas-apoyo";
import {
  auditoriaDePlataformaDe,
  clave,
  comoAdminAhora,
  comoAdministradorAhora,
  comoSoporteAhora,
  exito,
  falla,
} from "./marcas-y-planes-apoyo";

/**
 * Las listas del sistema en la consola de plataforma contra Postgres real (e3 §3.7, decisión 130): listar, agregar, corregir el nombre,
 * desactivar y reactivar; los permisos (SOPORTE solo ve), el nombre único sin distinguir mayúsculas ni acentos, «Otra» fija, la
 * idempotencia por clave y por estado, la versión esperada y la auditoría de plataforma con el valor de antes y el de después. Base
 * propia: las listas son globales y cada prueba cambia lo suyo.
 */

const base = inject("baseDePruebas");
const MARCAS = "MARCAS_DE_TARJETA";
const MOTIVOS = "MOTIVOS_DE_RECHAZO";
const INEXISTENTE = "00000000-0000-4000-8000-00000000dead";

describe.skipIf(base === null)("listas del sistema: casos de uso contra Postgres", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeListasDePrueba>;
  let casos: CasosDeUsoDeListas;
  let consultas: ConsultasDeListas;
  /** Cuando está puesto, la auditoría de plataforma lanza: prueba que el cambio y su constancia son una sola transacción. */
  let fallaEnLaAuditoria = false;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeListas(propia.base, 6, (tx) => ({
      ...tx,
      auditoriaDePlataforma: {
        registrar: async (registro) => {
          if (fallaEnLaAuditoria) throw new Error("falla inyectada en la auditoría");
          await tx.auditoriaDePlataforma.registrar(registro);
        },
      },
    }));
    casos = crearCasosDeListas(entorno);
    consultas = crearConsultasDeListasDePrueba(entorno);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const agregar = (lista: string, nombre: string, claveDeIdempotencia = clave()) =>
    casos.agregarValorDeLista(comoAdminAhora(), { claveDeIdempotencia, lista, nombre });
  const corregir = (
    valorId: string,
    nombre: string,
    versionEsperada: number,
    claveDeIdempotencia = clave(),
  ) =>
    casos.corregirNombreDeValor(comoAdminAhora(), {
      claveDeIdempotencia,
      valorId,
      nombre,
      versionEsperada,
    });
  const desactivar = (valorId: string, versionEsperada: number, claveDeIdempotencia = clave()) =>
    casos.desactivarValorDeLista(comoAdminAhora(), {
      claveDeIdempotencia,
      valorId,
      versionEsperada,
    });
  const reactivar = (valorId: string, versionEsperada: number, claveDeIdempotencia = clave()) =>
    casos.reactivarValorDeLista(comoAdminAhora(), {
      claveDeIdempotencia,
      valorId,
      versionEsperada,
    });
  const nombres = async (lista: string) =>
    (await valoresGuardados(dueno, lista)).map((v) => v.nombre);
  /** Un valor nuevo con nombre propio de la prueba (cada una trabaja con los suyos, sobre las semillas). */
  const nuevo = async (lista: string, nombre: string) => {
    exito(await agregar(lista, nombre));
    return valorPorNombre(dueno, lista, nombre);
  };

  describe("listarValoresDeLista", () => {
    it("devuelve las dos listas: las semillas por nombre (sin distinguir acentos) con «Otra» al final, con su versión", async () => {
      const { valores } = exito(await consultas.listarValoresDeLista(comoAdminAhora()));
      const de = (lista: string) => valores.filter((v) => v.lista === lista);
      expect(de(MARCAS).map((v) => v.nombre)).toEqual([
        "American Express",
        "Cabal",
        "Mastercard",
        "Naranja X",
        "Visa",
        "Otra",
      ]);
      expect(de(MOTIVOS).map((v) => v.nombre)).toEqual([
        "Envase dañado",
        "No es lo pedido",
        "Temperatura",
        "Vencida",
      ]);
      expect(valores.every((v) => v.activo && v.version === 1)).toBe(true);
      expect(valores.filter((v) => v.fija).map((v) => `${v.lista}:${v.nombre}`)).toEqual([
        `${MARCAS}:Otra`,
      ]);
      expect(typeof valores[0]?.id).toBe("string");
      expect(valores[0]?.actualizadoEn).toBeInstanceOf(Date);
    });

    it("con `lista` devuelve solo esa; sin ella (omitida o nula), las dos; una lista inventada es LISTA_INVALIDA", async () => {
      const soloMotivos = exito(
        await consultas.listarValoresDeLista(comoAdminAhora(), { lista: MOTIVOS }),
      );
      expect(new Set(soloMotivos.valores.map((v) => v.lista))).toEqual(new Set([MOTIVOS]));
      for (const entrada of [{}, { lista: null }, undefined]) {
        const todas = exito(await consultas.listarValoresDeLista(comoAdminAhora(), entrada));
        expect(new Set(todas.valores.map((v) => v.lista))).toEqual(new Set([MARCAS, MOTIVOS]));
      }
      for (const lista of ["NO_EXISTE", "", "marcas_de_tarjeta"]) {
        expect(
          falla(await consultas.listarValoresDeLista(comoAdminAhora(), { lista })),
          lista,
        ).toBe("LISTA_INVALIDA");
      }
    });

    it("incluye los valores desactivados (la consola los muestra para reactivarlos)", async () => {
      const v = await nuevo(MARCAS, "Diners Club");
      exito(await desactivar(v.id, v.version));
      const { valores } = exito(
        await consultas.listarValoresDeLista(comoAdminAhora(), { lista: MARCAS }),
      );
      expect(valores.find((x) => x.id === v.id)).toMatchObject({ activo: false, version: 2 });
    });

    it("SOPORTE ve; un administrador que no existe no ve nada", async () => {
      expect(
        exito(await consultas.listarValoresDeLista(comoSoporteAhora())).valores.length,
      ).toBeGreaterThan(0);
      const desconocido = comoAdministradorAhora(
        "aaaaaaaa-0000-4000-8000-0000000000ff" as typeof ADMIN_DE_PRUEBA,
      );
      expect(falla(await consultas.listarValoresDeLista(desconocido))).toBe("SIN_PERMISO");
    });
  });

  describe("permisos: SOPORTE solo ve", () => {
    it("SOPORTE no agrega, no corrige, no desactiva ni reactiva: SIN_PERMISO y no escribe nada", async () => {
      const v = await valorPorNombre(dueno, MARCAS, "Cabal");
      const antes = await huellaDeListas(dueno);
      const soporte = comoSoporteAhora();
      const resultados: ReadonlyArray<Resultado<unknown, unknown>> = [
        await casos.agregarValorDeLista(soporte, {
          claveDeIdempotencia: clave(),
          lista: MARCAS,
          nombre: "Marca de soporte",
        }),
        await casos.corregirNombreDeValor(soporte, {
          claveDeIdempotencia: clave(),
          valorId: v.id,
          nombre: "Cabal 2",
          versionEsperada: v.version,
        }),
        await casos.desactivarValorDeLista(soporte, {
          claveDeIdempotencia: clave(),
          valorId: v.id,
          versionEsperada: v.version,
        }),
        await casos.reactivarValorDeLista(soporte, {
          claveDeIdempotencia: clave(),
          valorId: v.id,
          versionEsperada: v.version,
        }),
      ];
      for (const r of resultados) expect(falla(r)).toBe("SIN_PERMISO");
      expect(await huellaDeListas(dueno)).toEqual(antes);
      expect(await valorPorNombre(dueno, MARCAS, "Cabal")).toEqual(v);
    });

    it("tampoco por SQL directo: el rol de plataforma con el actor SOPORTE no escribe la lista (la base lo exige además del guard)", async () => {
      const r = await entorno.ejecutar({ contexto: comoSoporteAhora() }, async (tx) => {
        await sql`insert into valor_de_lista (lista, nombre) values (${MARCAS}, 'Colada por SQL')`.execute(
          tx.db,
        );
        return { ok: true as const, valor: null };
      });
      expect(r).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
      expect(await nombres(MARCAS)).not.toContain("Colada por SQL");
    });
  });

  describe("agregarValorDeLista", () => {
    it("agrega el valor activo y no fijo, con su constancia de plataforma (actor, antes nulo y después) y su clave", async () => {
      const antes = await huellaDeListas(dueno);
      const salida = exito(await agregar(MARCAS, "Tarjeta Sol"));
      expect(typeof salida.valorId).toBe("string");
      expect(salida.version).toBe(1);
      expect(await valorPorNombre(dueno, MARCAS, "Tarjeta Sol")).toMatchObject({
        id: salida.valorId,
        activo: true,
        fija: false,
        version: 1,
      });
      expect(await huellaDeListas(dueno)).toEqual({
        valores: antes.valores + 1,
        cambios: antes.cambios + 1,
        auditoria: antes.auditoria + 1,
        claves: antes.claves + 1,
      });
      const [constancia] = await auditoriaDePlataformaDe(dueno, "valor_de_lista", salida.valorId);
      expect(constancia).toMatchObject({
        actor: ADMIN_DE_PRUEBA,
        accion: "VALOR_DE_LISTA_AGREGADO",
        antes: null,
        despues: { lista: MARCAS, nombre: "Tarjeta Sol", activo: true, fija: false, version: 1 },
      });
      expect(constancia?.creado_en).toBeInstanceOf(Date);
    });

    it("deja el nombre en su forma canónica (recortado, espacios repetidos en uno) y lo mismo en dos listas distintas es válido", async () => {
      exito(await agregar(MOTIVOS, "  Falta   de  frío "));
      expect(await nombres(MOTIVOS)).toContain("Falta de frío");
      // «Temperatura» ya está en motivos de rechazo: en la lista de marcas es otro valor.
      exito(await agregar(MARCAS, "Temperatura"));
      expect(await nombres(MARCAS)).toContain("Temperatura");
    });

    it("el mismo pedido con la misma clave devuelve lo mismo SIN agregar ni auditar de nuevo", async () => {
      const claveDeIdempotencia = clave();
      const primera = exito(await agregar(MARCAS, "Tarjeta Luna", claveDeIdempotencia));
      const antes = await huellaDeListas(dueno);
      expect(exito(await agregar(MARCAS, "Tarjeta Luna", claveDeIdempotencia))).toEqual(primera);
      // Escrito distinto pero igual una vez canónico, también es el mismo pedido.
      expect(exito(await agregar(MARCAS, " Tarjeta  Luna ", claveDeIdempotencia))).toEqual(primera);
      expect(await huellaDeListas(dueno)).toEqual(antes);
    });

    it("la misma clave con OTRO pedido es CLAVE_REUTILIZADA y no escribe", async () => {
      const claveDeIdempotencia = clave();
      exito(await agregar(MARCAS, "Tarjeta Mar", claveDeIdempotencia));
      const antes = await huellaDeListas(dueno);
      expect(falla(await agregar(MARCAS, "Tarjeta Mar 2", claveDeIdempotencia))).toBe(
        "CLAVE_REUTILIZADA",
      );
      expect(falla(await agregar(MOTIVOS, "Tarjeta Mar", claveDeIdempotencia))).toBe(
        "CLAVE_REUTILIZADA",
      );
      expect(await huellaDeListas(dueno)).toEqual(antes);
    });

    it("agregar dos veces seguidas el mismo valor, con otra clave, es VALOR_DUPLICADO: queda uno", async () => {
      exito(await agregar(MARCAS, "Tarjeta Cielo"));
      const antes = await huellaDeListas(dueno);
      expect(falla(await agregar(MARCAS, "Tarjeta Cielo"))).toBe("VALOR_DUPLICADO");
      expect(await huellaDeListas(dueno)).toEqual(antes);
      expect((await nombres(MARCAS)).filter((n) => n === "Tarjeta Cielo")).toHaveLength(1);
    });

    it("sin distinguir mayúsculas ni acentos: «ENVASE DANADO» y «envase dañado» chocan con «Envase dañado»", async () => {
      const antes = await huellaDeListas(dueno);
      for (const nombre of ["ENVASE DANADO", "envase dañado", "Envase Danado", "ENVASE DAÑADO"]) {
        expect(falla(await agregar(MOTIVOS, nombre)), nombre).toBe("VALOR_DUPLICADO");
      }
      expect(await huellaDeListas(dueno)).toEqual(antes);
      // «Otra» (el valor fijo) también cuenta para la única.
      expect(falla(await agregar(MARCAS, "otra"))).toBe("VALOR_DUPLICADO");
    });

    it("un valor desactivado también ocupa su nombre (nada se borra): agregarlo de nuevo es VALOR_DUPLICADO", async () => {
      const v = await nuevo(MARCAS, "Tarjeta Vieja");
      exito(await desactivar(v.id, v.version));
      expect(falla(await agregar(MARCAS, "tarjeta vieja"))).toBe("VALOR_DUPLICADO");
    });

    it("rechaza lista inventada, nombre vacío, de más de 40 caracteres o con algo fuera de la lista de permitidos, sin escribir", async () => {
      const antes = await huellaDeListas(dueno);
      expect(falla(await agregar("OTRA_LISTA", "Algo"))).toBe("LISTA_INVALIDA");
      expect(falla(await agregar("", "Algo"))).toBe("LISTA_INVALIDA");
      for (const nombre of ["", "   ", "a".repeat(41), "<b>x</b>", "a\nb", "a​b", "😀"]) {
        expect(falla(await agregar(MARCAS, nombre)), JSON.stringify(nombre)).toBe(
          "NOMBRE_INVALIDO",
        );
      }
      expect(falla(await agregar(MARCAS, 42 as unknown as string))).toBe("NOMBRE_INVALIDO");
      expect(
        falla(
          await casos.agregarValorDeLista(comoAdminAhora(), {
            claveDeIdempotencia: "corta",
            lista: MARCAS,
            nombre: "Algo",
          }),
        ),
      ).toBe("CLAVE_DE_IDEMPOTENCIA_INVALIDA");
      expect(await huellaDeListas(dueno)).toEqual(antes);
      // El límite exacto entra.
      exito(await agregar(MARCAS, "b".repeat(40)));
    });

    it("el cambio y su constancia son una sola transacción: si la auditoría falla, no queda el valor ni la clave", async () => {
      const antes = await huellaDeListas(dueno);
      fallaEnLaAuditoria = true;
      try {
        await expect(agregar(MARCAS, "Tarjeta Fantasma")).rejects.toThrow("falla inyectada");
      } finally {
        fallaEnLaAuditoria = false;
      }
      expect(await huellaDeListas(dueno)).toEqual(antes);
      expect(await nombres(MARCAS)).not.toContain("Tarjeta Fantasma");
    });
  });

  describe("corregirNombreDeValor", () => {
    it("cambia el nombre, sube la versión y deja la constancia con el valor de antes y el de después", async () => {
      const v = await nuevo(MARCAS, "Tarjeta Errada");
      const antes = await huellaDeListas(dueno);
      const salida = exito(await corregir(v.id, "Tarjeta Correcta", v.version));
      expect(salida).toEqual({ version: v.version + 1, sinCambios: false });
      expect(await valorPorNombre(dueno, MARCAS, "Tarjeta Correcta")).toMatchObject({
        id: v.id,
        activo: true,
        version: v.version + 1,
      });
      expect(await huellaDeListas(dueno)).toEqual({
        ...antes,
        cambios: antes.cambios + 1,
        auditoria: antes.auditoria + 1,
        claves: antes.claves + 1,
      });
      const constancias = await auditoriaDePlataformaDe(dueno, "valor_de_lista", v.id);
      expect(constancias.at(-1)).toMatchObject({
        actor: ADMIN_DE_PRUEBA,
        accion: "VALOR_DE_LISTA_RENOMBRADO",
        antes: { lista: MARCAS, nombre: "Tarjeta Errada", activo: true, fija: false, version: 1 },
        despues: {
          lista: MARCAS,
          nombre: "Tarjeta Correcta",
          activo: true,
          fija: false,
          version: 2,
        },
      });
    });

    it("cambiar solo las mayúsculas o los acentos de ESTE valor es válido (la única es contra otros valores)", async () => {
      const v = await nuevo(MOTIVOS, "Envase roto");
      exito(await corregir(v.id, "ENVASE ROTO", v.version));
      expect((await valorPorNombre(dueno, MOTIVOS, "ENVASE ROTO")).version).toBe(v.version + 1);
      exito(await corregir(v.id, "Envase róto", v.version + 1));
      expect((await valorPorNombre(dueno, MOTIVOS, "Envase róto")).version).toBe(v.version + 2);
    });

    it("el nombre que ya tiene, tal cual, es éxito sin escribir ni auditar", async () => {
      const v = await nuevo(MARCAS, "Tarjeta Igual");
      const antes = await huellaDeListas(dueno);
      expect(exito(await corregir(v.id, "  Tarjeta   Igual ", v.version))).toEqual({
        version: v.version,
        sinCambios: true,
      });
      // Solo la clave de idempotencia (el resultado de lo que se pidió) queda registrada.
      expect(await huellaDeListas(dueno)).toEqual({ ...antes, claves: antes.claves + 1 });
    });

    it("con otra versión de la que vio quien corrige es VERSION_DESACTUALIZADA y no cambia nada", async () => {
      const v = await nuevo(MARCAS, "Tarjeta Vieja V");
      exito(await corregir(v.id, "Tarjeta Nueva V", v.version));
      const antes = await huellaDeListas(dueno);
      expect(falla(await corregir(v.id, "Tarjeta Otra V", v.version))).toBe(
        "VERSION_DESACTUALIZADA",
      );
      expect(falla(await corregir(v.id, "Tarjeta Otra V", v.version + 5))).toBe(
        "VERSION_DESACTUALIZADA",
      );
      expect(await huellaDeListas(dueno)).toEqual(antes);
    });

    it("el nombre de OTRO valor de la lista, sin distinguir mayúsculas ni acentos, es VALOR_DUPLICADO", async () => {
      const v = await nuevo(MARCAS, "Tarjeta Propia");
      const antes = await huellaDeListas(dueno);
      for (const nombre of ["visa", "VISA", "Mastercard", "otra"]) {
        expect(falla(await corregir(v.id, nombre, v.version)), nombre).toBe("VALOR_DUPLICADO");
      }
      expect(await huellaDeListas(dueno)).toEqual(antes);
      // El mismo nombre en la OTRA lista no choca.
      exito(await corregir(v.id, "Vencida", v.version));
    });

    it("«Otra» (fija) no se renombra, con la versión correcta o con cualquiera", async () => {
      const otra = await valorPorNombre(dueno, MARCAS, "Otra");
      const antes = await huellaDeListas(dueno);
      expect(falla(await corregir(otra.id, "Cualquiera", otra.version))).toBe("VALOR_FIJO");
      expect(falla(await corregir(otra.id, "Cualquiera", otra.version + 3))).toBe("VALOR_FIJO");
      expect(await huellaDeListas(dueno)).toEqual(antes);
      expect(await valorPorNombre(dueno, MARCAS, "Otra")).toEqual(otra);
    });

    it("un valor que no existe, un id mal formado, una versión inválida y un nombre inválido se rechazan", async () => {
      const v = await nuevo(MARCAS, "Tarjeta Valida");
      expect(falla(await corregir(INEXISTENTE, "Algo", 1))).toBe("VALOR_NO_ENCONTRADO");
      expect(falla(await corregir("no-es-un-uuid", "Algo", 1))).toBe("ID_INVALIDO");
      for (const version of [0, -1, 1.5, Number.NaN]) {
        expect(falla(await corregir(v.id, "Algo", version)), String(version)).toBe(
          "VERSION_ESPERADA_INVALIDA",
        );
      }
      expect(falla(await corregir(v.id, "", v.version))).toBe("NOMBRE_INVALIDO");
      expect(falla(await corregir(v.id, "x".repeat(41), v.version))).toBe("NOMBRE_INVALIDO");
    });

    it("la misma clave devuelve lo del primero (marcado «sin cambios») sin escribir; con otro pedido es CLAVE_REUTILIZADA", async () => {
      const v = await nuevo(MARCAS, "Tarjeta Clave");
      const claveDeIdempotencia = clave();
      exito(await corregir(v.id, "Tarjeta Clave 2", v.version, claveDeIdempotencia));
      const antes = await huellaDeListas(dueno);
      expect(
        exito(await corregir(v.id, "Tarjeta Clave 2", v.version, claveDeIdempotencia)),
      ).toEqual({
        version: v.version + 1,
        sinCambios: true,
      });
      expect(falla(await corregir(v.id, "Tarjeta Clave 3", v.version, claveDeIdempotencia))).toBe(
        "CLAVE_REUTILIZADA",
      );
      expect(await huellaDeListas(dueno)).toEqual(antes);
    });
  });

  describe("desactivarValorDeLista y reactivarValorDeLista", () => {
    it("desactivar deja el valor inactivo (no se borra), sube la versión y deja la constancia; reactivar lo devuelve", async () => {
      const v = await nuevo(MARCAS, "Tarjeta Pausa");
      const antes = await huellaDeListas(dueno);
      expect(exito(await desactivar(v.id, v.version))).toEqual({
        version: v.version + 1,
        yaEstabaInactivo: false,
      });
      expect(await valorPorNombre(dueno, MARCAS, "Tarjeta Pausa")).toMatchObject({
        activo: false,
        version: 2,
      });
      expect((await huellaDeListas(dueno)).valores).toBe(antes.valores);
      expect(exito(await reactivar(v.id, v.version + 1))).toEqual({
        version: v.version + 2,
        yaEstabaActivo: false,
      });
      expect(await valorPorNombre(dueno, MARCAS, "Tarjeta Pausa")).toMatchObject({
        activo: true,
        version: 3,
      });
      const constancias = await auditoriaDePlataformaDe(dueno, "valor_de_lista", v.id);
      expect(constancias.map((c) => c.accion)).toEqual([
        "VALOR_DE_LISTA_AGREGADO",
        "VALOR_DE_LISTA_DESACTIVADO",
        "VALOR_DE_LISTA_REACTIVADO",
      ]);
      expect(constancias[1]).toMatchObject({
        actor: ADMIN_DE_PRUEBA,
        antes: { nombre: "Tarjeta Pausa", activo: true, version: 1 },
        despues: { nombre: "Tarjeta Pausa", activo: false, version: 2 },
      });
      expect(constancias[2]).toMatchObject({
        antes: { activo: false, version: 2 },
        despues: { activo: true, version: 3 },
      });
    });

    it("desactivar lo inactivo y reactivar lo activo son éxito sin escribir ni auditar, con cualquier versión y con otra clave", async () => {
      const v = await nuevo(MARCAS, "Tarjeta Idem");
      exito(await desactivar(v.id, v.version));
      const antes = await huellaDeListas(dueno);
      expect(exito(await desactivar(v.id, v.version))).toEqual({
        version: v.version + 1,
        yaEstabaInactivo: true,
      });
      expect(exito(await desactivar(v.id, 99))).toEqual({
        version: v.version + 1,
        yaEstabaInactivo: true,
      });
      expect((await huellaDeListas(dueno)).auditoria).toBe(antes.auditoria);
      expect((await huellaDeListas(dueno)).cambios).toBe(antes.cambios);
      exito(await reactivar(v.id, v.version + 1));
      const despues = await huellaDeListas(dueno);
      expect(exito(await reactivar(v.id, 1))).toEqual({
        version: v.version + 2,
        yaEstabaActivo: true,
      });
      expect((await huellaDeListas(dueno)).auditoria).toBe(despues.auditoria);
      expect((await huellaDeListas(dueno)).cambios).toBe(despues.cambios);
    });

    it("la misma clave devuelve lo del primero marcado «ya estaba»", async () => {
      const v = await nuevo(MARCAS, "Tarjeta Doble");
      const claveDeIdempotencia = clave();
      exito(await desactivar(v.id, v.version, claveDeIdempotencia));
      const antes = await huellaDeListas(dueno);
      expect(exito(await desactivar(v.id, v.version, claveDeIdempotencia))).toEqual({
        version: v.version + 1,
        yaEstabaInactivo: true,
      });
      expect(await huellaDeListas(dueno)).toEqual(antes);
      const otra = clave();
      exito(await reactivar(v.id, v.version + 1, otra));
      expect(exito(await reactivar(v.id, v.version + 1, otra))).toEqual({
        version: v.version + 2,
        yaEstabaActivo: true,
      });
    });

    it("con otra versión y algo que cambiar es VERSION_DESACTUALIZADA", async () => {
      const v = await nuevo(MARCAS, "Tarjeta Version");
      exito(await corregir(v.id, "Tarjeta Version 2", v.version));
      expect(falla(await desactivar(v.id, v.version))).toBe("VERSION_DESACTUALIZADA");
      const actual = await valorPorNombre(dueno, MARCAS, "Tarjeta Version 2");
      exito(await desactivar(v.id, actual.version));
      expect(falla(await reactivar(v.id, actual.version))).toBe("VERSION_DESACTUALIZADA");
    });

    it("«Otra» (fija) no se desactiva; reactivarla es éxito sin cambios (siempre está activa)", async () => {
      const otra = await valorPorNombre(dueno, MARCAS, "Otra");
      const antes = await huellaDeListas(dueno);
      expect(falla(await desactivar(otra.id, otra.version))).toBe("VALOR_FIJO");
      expect(falla(await desactivar(otra.id, 99))).toBe("VALOR_FIJO");
      expect(exito(await reactivar(otra.id, otra.version))).toMatchObject({ yaEstabaActivo: true });
      expect((await huellaDeListas(dueno)).auditoria).toBe(antes.auditoria);
      expect(await valorPorNombre(dueno, MARCAS, "Otra")).toEqual(otra);
    });

    it("un valor que no existe, un id mal formado y una versión inválida se rechazan", async () => {
      expect(falla(await desactivar(INEXISTENTE, 1))).toBe("VALOR_NO_ENCONTRADO");
      expect(falla(await reactivar(INEXISTENTE, 1))).toBe("VALOR_NO_ENCONTRADO");
      expect(falla(await desactivar("x", 1))).toBe("ID_INVALIDO");
      expect(falla(await reactivar("x", 1))).toBe("ID_INVALIDO");
      const v = await valorPorNombre(dueno, MARCAS, "Visa");
      expect(falla(await desactivar(v.id, 0))).toBe("VERSION_ESPERADA_INVALIDA");
      expect(falla(await reactivar(v.id, 0))).toBe("VERSION_ESPERADA_INVALIDA");
    });
  });

  describe("quién cambia queda en la auditoría de plataforma", () => {
    it("otro administrador de plataforma queda como actor de SU cambio", async () => {
      const segundo = "aaaaaaaa-0000-4000-8000-000000000003";
      await dueno.query(
        "insert into admin_plataforma (id, email, rol) values ($1, 'segundo-admin@prueba.test', 'ADMIN') on conflict do nothing",
        [segundo],
      );
      const v = await nuevo(MARCAS, "Tarjeta Del Otro");
      const r = await casos.desactivarValorDeLista(
        comoAdministradorAhora(segundo as typeof ADMIN_DE_PRUEBA),
        { claveDeIdempotencia: clave(), valorId: v.id, versionEsperada: v.version },
      );
      exito(r);
      const constancias = await auditoriaDePlataformaDe(dueno, "valor_de_lista", v.id);
      expect(constancias.map((c) => c.actor)).toEqual([ADMIN_DE_PRUEBA, segundo]);
      expect(SOPORTE_DE_PRUEBA).not.toBe(segundo);
    });
  });
});

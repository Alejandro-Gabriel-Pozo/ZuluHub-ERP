import { randomBytes, randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  certificadoId,
  comprobanteId,
  crearRepositorioDeAccesos,
  crearRepositorioDeCertificados,
  crearRepositorioDeIntentos,
  intentoId,
  traducirErroresDeFiscal,
  type FiscalDb,
} from "../../src/modulos/fiscal/publico";
import type { Contexto } from "../../src/contexto/contexto";
import { empresaId } from "../../src/primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import { crearEscenario, type Escenario } from "./facturacion-apoyo";
import { crearMundo } from "./fiscal-apoyo";
import {
  altaDe,
  cargaDe,
  comoPersonaDe,
  comoSistemaDe,
  crearEntornoFacturacion,
  intentoDe,
  pedidoDe,
  type TxFacturacionDePrueba,
} from "./facturacion-persistencia-apoyo";

/**
 * Facturación F3: los repositorios de certificados, de la credencial de acceso a ARCA y de los intentos, contra una
 * base real. Lo que más importa: nada que sea secreto sale por una lectura común (la clave y la credencial
 * cifradas solo salen por `obtenerClave` y `obtenerCredencial`), a lo sumo un certificado vigente por emisor y
 * ambiente, una sola renovación de la credencial a la vez, y los intentos son de solo inserción y nunca guardan
 * una credencial.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

function exito<T, E>(r: Resultado<T, E>): T {
  if (!r.ok) throw new Error(`tenía que ser un éxito: ${JSON.stringify(r.error)}`);
  return r.valor;
}

describe.skipIf(base === null)("facturación F3: certificados, accesos e intentos", () => {
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoFacturacion>;

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
    entorno = crearEntornoFacturacion(base);
  });
  afterAll(async () => {
    await entorno.cerrar();
    await dueno.end();
  });

  const consultar = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;
  const escenario = (opciones: Parameters<typeof crearEscenario>[1] = {}) =>
    crearEscenario(dueno, opciones);
  async function correr<T>(
    contexto: Contexto,
    trabajo: (tx: TxFacturacionDePrueba) => Promise<T>,
  ): Promise<T> {
    const r = await entorno.ejecutar({ contexto }, async (tx) => ok(await trabajo(tx)));
    if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
    return r.valor;
  }
  const intentar = <T>(contexto: Contexto, trabajo: (tx: TxFacturacionDePrueba) => Promise<T>) =>
    entorno.ejecutar({ contexto }, async (tx) => ok(await trabajo(tx)));
  const estados = async (e: Escenario) =>
    (
      await consultar<{ estado: string }>(
        "select estado from certificado_arca where empresa_id = $1 order by creado_en, id",
        [e.empresa],
      )
    ).map((f) => f.estado);

  // ===============================================================================================
  // Certificados
  // ===============================================================================================
  describe("certificados", () => {
    it("el pedido se guarda, se lee SIN clave, y la clave cifrada vuelve intacta solo por `obtenerClave`", async () => {
      const e = await escenario();
      const pedido = pedidoDe(e);
      const r = exito(await correr(comoPersonaDe(e), (tx) => tx.certificados.crearPedido(pedido)));
      expect(r.creado).toBe(true);
      expect(r.valor).toMatchObject({
        id: pedido.id,
        empresaId: pedido.empresaId,
        emisorId: pedido.emisorId,
        ambiente: "HOMOLOGACION",
        alias: pedido.alias,
        cuitTitular: e.cuit,
        estado: "PEDIDO_GENERADO",
        pedidoPem: pedido.pedidoPem,
        certificadoPem: null,
        huellaSha256: null,
        venceEn: null,
        autorizacionVerificadaEn: null,
        creadoPor: pedido.creadoPor,
        version: 1,
      });
      // «Nunca se muestra»: ni las columnas de la clave ni sus bytes aparecen en lo que devuelve una lectura.
      const leido = await correr(comoPersonaDe(e), (tx) =>
        tx.certificados.obtener(empresaId(e.empresa), pedido.id),
      );
      const texto = JSON.stringify(leido);
      expect(
        Object.keys(leido ?? {}).filter((k) => /clave|nonce|etiqueta|cifrad|kid/i.test(k)),
      ).toEqual([]);
      for (const secreto of [pedido.clave.cifrado, pedido.clave.nonce, pedido.clave.etiqueta]) {
        expect(texto).not.toContain(Buffer.from(secreto).toString("base64"));
        expect(texto).not.toContain(Buffer.from(secreto).toString("hex"));
      }
      const clave = await correr(comoPersonaDe(e), (tx) =>
        tx.certificados.obtenerClave(empresaId(e.empresa), pedido.id),
      );
      expect(clave).not.toBeNull();
      expect(Buffer.from(clave?.cifrado ?? []).equals(Buffer.from(pedido.clave.cifrado))).toBe(
        true,
      );
      expect(Buffer.from(clave?.nonce ?? []).equals(Buffer.from(pedido.clave.nonce))).toBe(true);
      expect(Buffer.from(clave?.etiqueta ?? []).equals(Buffer.from(pedido.clave.etiqueta))).toBe(
        true,
      );
      expect(clave?.kid).toBe("k1");
    });

    it("repetir el pedido es un éxito (creado: false); el mismo id con otro contenido, o de otra empresa, es ID_EN_USO", async () => {
      const a = await escenario();
      const b = await escenario();
      const pedido = pedidoDe(a);
      const primero = exito(
        await correr(comoPersonaDe(a), (tx) => tx.certificados.crearPedido(pedido)),
      );
      const segundo = exito(
        await correr(comoPersonaDe(a), (tx) => tx.certificados.crearPedido(pedido)),
      );
      expect(segundo).toEqual({ creado: false, valor: primero.valor });
      expect(
        await correr(comoPersonaDe(a), (tx) =>
          tx.certificados.crearPedido({ ...pedido, alias: "otroalias" }),
        ),
      ).toEqual(err("ID_EN_USO"));
      expect(
        await correr(comoPersonaDe(b), (tx) =>
          tx.certificados.crearPedido({ ...pedidoDe(b), id: pedido.id }),
        ),
      ).toEqual(err("ID_EN_USO"));
      expect(
        (await consultar("select 1 from certificado_arca where empresa_id = $1", [a.empresa]))
          .length,
      ).toBe(1);
    });

    it("cargar el certificado lo deja VIGENTE; cargar otro para el mismo emisor y ambiente reemplaza al anterior en la misma transacción", async () => {
      const e = await escenario();
      const uno = pedidoDe(e);
      const dos = pedidoDe(e);
      const homo2 = pedidoDe(e, { ambiente: "PRODUCCION" });
      for (const p of [uno, dos, homo2])
        await correr(comoPersonaDe(e), (tx) => tx.certificados.crearPedido(p));
      const carga1 = cargaDe();
      const a1 = await correr(comoPersonaDe(e), (tx) =>
        tx.certificados.activar(empresaId(e.empresa), uno.id, 1, carga1),
      );
      expect(a1?.reemplazado).toBeNull();
      expect(a1?.certificado).toMatchObject({
        estado: "VIGENTE",
        certificadoPem: carga1.certificadoPem,
        huellaSha256: carga1.huellaSha256,
        venceEn: carga1.venceEn,
        version: 2,
      });
      // Otro ambiente: no se toca.
      await correr(comoPersonaDe(e), (tx) =>
        tx.certificados.activar(empresaId(e.empresa), homo2.id, 1, cargaDe()),
      );
      const a2 = await correr(comoPersonaDe(e), (tx) =>
        tx.certificados.activar(empresaId(e.empresa), dos.id, 1, cargaDe()),
      );
      expect(a2?.certificado.estado).toBe("VIGENTE");
      expect(a2?.reemplazado).toMatchObject({
        id: uno.id,
        estado: "REEMPLAZADO",
        huellaSha256: carga1.huellaSha256,
      });
      const vigente = await correr(comoPersonaDe(e), (tx) =>
        tx.certificados.vigente(empresaId(e.empresa), uno.emisorId, "HOMOLOGACION"),
      );
      expect(vigente?.id).toBe(dos.id);
      expect(
        (
          await correr(comoPersonaDe(e), (tx) =>
            tx.certificados.vigente(empresaId(e.empresa), uno.emisorId, "PRODUCCION"),
          )
        )?.id,
      ).toBe(homo2.id);
      expect(await estados(e)).toEqual(["REEMPLAZADO", "VIGENTE", "VIGENTE"]);
    });

    it("con una versión vieja, o si ya no es un pedido, `activar` devuelve null y NO reemplaza al vigente", async () => {
      const e = await escenario();
      const vigente = pedidoDe(e);
      const nuevo = pedidoDe(e);
      for (const p of [vigente, nuevo])
        await correr(comoPersonaDe(e), (tx) => tx.certificados.crearPedido(p));
      await correr(comoPersonaDe(e), (tx) =>
        tx.certificados.activar(empresaId(e.empresa), vigente.id, 1, cargaDe()),
      );
      expect(
        await correr(comoPersonaDe(e), (tx) =>
          tx.certificados.activar(empresaId(e.empresa), nuevo.id, 9, cargaDe()),
        ),
      ).toBeNull();
      // Un certificado que ya es vigente no se vuelve a «cargar» como pedido.
      expect(
        await correr(comoPersonaDe(e), (tx) =>
          tx.certificados.activar(empresaId(e.empresa), vigente.id, 2, cargaDe()),
        ),
      ).toBeNull();
      expect(
        await correr(comoPersonaDe(e), (tx) =>
          tx.certificados.activar(empresaId(e.empresa), certificadoId(randomUUID()), 1, cargaDe()),
        ),
      ).toBeNull();
      expect(await estados(e)).toEqual(["VIGENTE", "PEDIDO_GENERADO"]);
    });

    it("el mismo certificado (misma huella) no se carga dos veces: error con nombre y el vigente sigue vigente", async () => {
      const e = await escenario();
      const uno = pedidoDe(e);
      const dos = pedidoDe(e);
      for (const p of [uno, dos])
        await correr(comoPersonaDe(e), (tx) => tx.certificados.crearPedido(p));
      const carga = cargaDe();
      await correr(comoPersonaDe(e), (tx) =>
        tx.certificados.activar(empresaId(e.empresa), uno.id, 1, carga),
      );
      // `porHuella` es lo que consulta el caso de uso para decir «ya estaba».
      expect(
        (
          await correr(comoPersonaDe(e), (tx) =>
            tx.certificados.porHuella(empresaId(e.empresa), carga.huellaSha256),
          )
        )?.id,
      ).toBe(uno.id);
      const r = await intentar(comoPersonaDe(e), (tx) =>
        tx.certificados.activar(empresaId(e.empresa), dos.id, 1, carga),
      );
      expect(r).toEqual(err({ tipo: "Unicidad", restriccion: "certificado_huella_uk" }));
      expect(traducirErroresDeFiscal(r, ["CERTIFICADO_YA_CARGADO"])).toEqual(
        err("CERTIFICADO_YA_CARGADO"),
      );
      // Nada a medias: el reemplazo del vigente se deshizo con el resto.
      expect(await estados(e)).toEqual(["VIGENTE", "PEDIDO_GENERADO"]);
    });

    it("un pedido se descarta (y solo un pedido); una huella de otra empresa no se cruza", async () => {
      const a = await escenario();
      const b = await escenario();
      const pedido = pedidoDe(a);
      const otro = pedidoDe(a);
      for (const p of [pedido, otro])
        await correr(comoPersonaDe(a), (tx) => tx.certificados.crearPedido(p));
      expect(
        await correr(comoPersonaDe(a), (tx) =>
          tx.certificados.descartar(empresaId(a.empresa), pedido.id, 7),
        ),
      ).toBeNull();
      const descartado = await correr(comoPersonaDe(a), (tx) =>
        tx.certificados.descartar(empresaId(a.empresa), pedido.id, 1),
      );
      expect(descartado).toMatchObject({ estado: "DESCARTADO", version: 2 });
      // Un descartado no se carga ni se descarta de nuevo.
      expect(
        await correr(comoPersonaDe(a), (tx) =>
          tx.certificados.activar(empresaId(a.empresa), pedido.id, 2, cargaDe()),
        ),
      ).toBeNull();
      expect(
        await correr(comoPersonaDe(a), (tx) =>
          tx.certificados.descartar(empresaId(a.empresa), pedido.id, 2),
        ),
      ).toBeNull();
      // Un vigente tampoco se descarta.
      await correr(comoPersonaDe(a), (tx) =>
        tx.certificados.activar(empresaId(a.empresa), otro.id, 1, cargaDe()),
      );
      expect(
        await correr(comoPersonaDe(a), (tx) =>
          tx.certificados.descartar(empresaId(a.empresa), otro.id, 2),
        ),
      ).toBeNull();
      // Otra empresa puede cargar una huella que A también tiene cargada? No hay cruce: cada una ve solo lo suyo.
      const huella =
        (
          await correr(comoPersonaDe(a), (tx) =>
            tx.certificados.obtener(empresaId(a.empresa), otro.id),
          )
        )?.huellaSha256 ?? "";
      expect(
        await correr(comoPersonaDe(b), (tx) =>
          tx.certificados.porHuella(empresaId(b.empresa), huella),
        ),
      ).toBeNull();
    });

    it("la primera llamada exitosa a ARCA se anota UNA vez, y solo en un certificado vigente", async () => {
      const e = await escenario();
      const p = pedidoDe(e);
      await correr(comoPersonaDe(e), (tx) => tx.certificados.crearPedido(p));
      const cuando = new Date("2026-10-12T15:00:00.000Z");
      // Un pedido todavía no es vigente.
      expect(
        await correr(comoSistemaDe(e), (tx) =>
          tx.certificados.anotarVerificacion(empresaId(e.empresa), p.id, cuando),
        ),
      ).toBeNull();
      await correr(comoPersonaDe(e), (tx) =>
        tx.certificados.activar(empresaId(e.empresa), p.id, 1, cargaDe()),
      );
      const anotado = await correr(comoSistemaDe(e), (tx) =>
        tx.certificados.anotarVerificacion(empresaId(e.empresa), p.id, cuando),
      );
      expect(anotado?.autorizacionVerificadaEn).toEqual(cuando);
      // La segunda no pisa a la primera.
      expect(
        await correr(comoSistemaDe(e), (tx) =>
          tx.certificados.anotarVerificacion(
            empresaId(e.empresa),
            p.id,
            new Date("2026-10-13T00:00:00Z"),
          ),
        ),
      ).toBeNull();
      expect(
        (
          await correr(comoSistemaDe(e), (tx) =>
            tx.certificados.obtener(empresaId(e.empresa), p.id),
          )
        )?.autorizacionVerificadaEn,
      ).toEqual(cuando);
    });

    it("lo que escribe una persona se traduce con nombre: un alias inválido y un certificado vacío o desmesurado", async () => {
      const e = await escenario();
      const alias = await intentar(comoPersonaDe(e), (tx) =>
        tx.certificados.crearPedido(pedidoDe(e, { alias: "con espacios" })),
      );
      expect(alias).toEqual(err({ tipo: "Check", restriccion: "certificado_alias_ck" }));
      expect(traducirErroresDeFiscal(alias, ["ALIAS_INVALIDO"])).toEqual(err("ALIAS_INVALIDO"));
      const p = pedidoDe(e);
      await correr(comoPersonaDe(e), (tx) => tx.certificados.crearPedido(p));
      const enorme = await intentar(comoPersonaDe(e), (tx) =>
        tx.certificados.activar(
          empresaId(e.empresa),
          p.id,
          1,
          cargaDe({ certificadoPem: "x".repeat(16385) }),
        ),
      );
      expect(enorme).toEqual(err({ tipo: "Check", restriccion: "certificado_pem_ck" }));
      expect(traducirErroresDeFiscal(enorme, ["CERTIFICADO_ILEGIBLE"])).toEqual(
        err("CERTIFICADO_ILEGIBLE"),
      );
      expect(await estados(e)).toEqual(["PEDIDO_GENERADO"]);
    });

    it("aislamiento: otra empresa no ve, no carga, no descarta ni lee la clave de un certificado ajeno; un emisor ajeno no se puede nombrar", async () => {
      const a = await escenario();
      const b = await escenario({ mundo: await crearMundo(dueno, { tenant: a.tenant }) });
      const p = pedidoDe(a);
      await correr(comoPersonaDe(a), (tx) => tx.certificados.crearPedido(p));
      const desdeB = await correr(comoPersonaDe(b), async (tx) => ({
        obtener: await tx.certificados.obtener(empresaId(a.empresa), p.id),
        clave: await tx.certificados.obtenerClave(empresaId(a.empresa), p.id),
        vigente: await tx.certificados.vigente(empresaId(a.empresa), p.emisorId, "HOMOLOGACION"),
        activar: await tx.certificados.activar(empresaId(a.empresa), p.id, 1, cargaDe()),
        descartar: await tx.certificados.descartar(empresaId(a.empresa), p.id, 1),
      }));
      expect(desdeB).toEqual({
        obtener: null,
        clave: null,
        vigente: null,
        activar: null,
        descartar: null,
      });
      const aEmisorAjeno = await intentar(comoPersonaDe(b), (tx) =>
        tx.certificados.crearPedido(pedidoDe(b, { emisorId: p.emisorId })),
      );
      expect(aEmisorAjeno).toEqual(
        err({ tipo: "Referencia", restriccion: "certificado_emisor_fkey" }),
      );
      expect(traducirErroresDeFiscal(aEmisorAjeno, ["EMISOR_NO_ENCONTRADO"])).toEqual(
        err("EMISOR_NO_ENCONTRADO"),
      );
      expect(await estados(a)).toEqual(["PEDIDO_GENERADO"]);
    });

    describe("sin RLS (el dueño de la base la evade), los repositorios siguen filtrando por empresa", () => {
      let pool: pg.Pool;
      let sinRls: Kysely<FiscalDb>;
      beforeAll(() => {
        if (base === null) return;
        pool = new pg.Pool({ connectionString: base.dueno, max: 2 });
        sinRls = new Kysely<FiscalDb>({ dialect: new PostgresDialect({ pool }) });
      });
      afterAll(async () => {
        await sinRls.destroy();
      });

      it("certificados, accesos e intentos de otra empresa no se leen ni se tocan aunque se tenga el id", async () => {
        const a = await escenario();
        const b = await escenario();
        const p = pedidoDe(a);
        const alta = altaDe(a);
        await correr(comoPersonaDe(a), async (tx) => {
          exito(await tx.certificados.crearPedido(p));
          exito(await tx.comprobantes.crear(alta));
          exito(await tx.intentos.registrar(intentoDe(a, alta.id)));
          await tx.certificados.activar(empresaId(a.empresa), p.id, 1, cargaDe());
          await tx.accesos.asegurar(empresaId(a.empresa), p.id, "wsfe");
        });
        const certificados = crearRepositorioDeCertificados(sinRls);
        const accesos = crearRepositorioDeAccesos(sinRls);
        const intentos = crearRepositorioDeIntentos(sinRls);
        const eB = empresaId(b.empresa);
        expect(await certificados.obtener(empresaId(a.empresa), p.id)).not.toBeNull(); // control
        expect(await certificados.obtener(eB, p.id)).toBeNull();
        expect(await certificados.obtenerClave(eB, p.id)).toBeNull();
        expect(await certificados.vigente(eB, p.emisorId, "HOMOLOGACION")).toBeNull();
        expect(await certificados.activar(eB, p.id, 2, cargaDe())).toBeNull();
        expect(await certificados.descartar(eB, p.id, 2)).toBeNull();
        expect(await certificados.anotarVerificacion(eB, p.id, new Date())).toBeNull();
        expect(await accesos.obtener(eB, p.id, "wsfe")).toBeNull();
        expect(await accesos.obtenerCredencial(eB, p.id, "wsfe")).toBeNull();
        expect(await accesos.tomarRenovacion(eB, p.id, "wsfe", new Date(0), new Date(1))).toBe(
          false,
        );
        expect(
          await accesos.guardarCredencial(eB, p.id, "wsfe", {
            credencial: {
              cifrado: randomBytes(8),
              nonce: randomBytes(12),
              etiqueta: randomBytes(16),
              kid: "k",
            },
            generadoEn: new Date(0),
            expiraEn: new Date(1000),
          }),
        ).toBeNull();
        expect(await intentos.delComprobante(eB, alta.id)).toEqual([]);
        expect(
          (
            await consultar<{ estado: string }>(
              "select estado from certificado_arca where id = $1",
              [p.id],
            )
          )[0],
        ).toEqual({ estado: "VIGENTE" });
      });
    });
  });

  // ===============================================================================================
  // Credencial de acceso
  // ===============================================================================================
  describe("credencial de acceso a ARCA", () => {
    const conCertificado = async () => {
      const e = await escenario();
      const p = pedidoDe(e);
      await correr(comoPersonaDe(e), (tx) => tx.certificados.crearPedido(p));
      await correr(comoPersonaDe(e), (tx) =>
        tx.certificados.activar(empresaId(e.empresa), p.id, 1, cargaDe()),
      );
      return { e, c: p.id };
    };
    const credencial = (generadoEn: Date, horas = 12) => ({
      credencial: {
        cifrado: randomBytes(300),
        nonce: randomBytes(12),
        etiqueta: randomBytes(16),
        kid: "k1",
      },
      generadoEn,
      expiraEn: new Date(generadoEn.getTime() + horas * 3_600_000),
    });
    const T0 = new Date("2026-10-12T12:00:00.000Z");

    it("la fila nace vacía (y repetir `asegurar` no la pisa); `obtener` nunca trae la credencial", async () => {
      const { e, c } = await conCertificado();
      const vacia = await correr(comoSistemaDe(e), (tx) =>
        tx.accesos.asegurar(empresaId(e.empresa), c, "wsfe"),
      );
      expect(vacia).toMatchObject({
        servicio: "wsfe",
        tieneCredencial: false,
        generadoEn: null,
        expiraEn: null,
        renovandoHasta: null,
        version: 1,
      });
      expect(
        await correr(comoSistemaDe(e), (tx) =>
          tx.accesos.obtenerCredencial(empresaId(e.empresa), c, "wsfe"),
        ),
      ).toBeNull();
      const cred = credencial(T0);
      await correr(comoSistemaDe(e), (tx) =>
        tx.accesos.guardarCredencial(empresaId(e.empresa), c, "wsfe", cred),
      );
      const otraVez = await correr(comoSistemaDe(e), (tx) =>
        tx.accesos.asegurar(empresaId(e.empresa), c, "wsfe"),
      );
      expect(otraVez).toMatchObject({ tieneCredencial: true, expiraEn: cred.expiraEn });
      expect(
        Object.keys(otraVez).filter(
          (k) =>
            /credencial(?!es)|cifrad|nonce|etiqueta|token|sign/i.test(k) && k !== "tieneCredencial",
        ),
      ).toEqual([]);
      expect(JSON.stringify(otraVez)).not.toContain(
        Buffer.from(cred.credencial.cifrado).toString("base64"),
      );
    });

    it("guardar la credencial la devuelve intacta (bytes y fechas), pisa la anterior y suelta la renovación", async () => {
      const { e, c } = await conCertificado();
      await correr(comoSistemaDe(e), (tx) => tx.accesos.asegurar(empresaId(e.empresa), c, "wsfe"));
      const primera = credencial(T0);
      const guardada = await correr(comoSistemaDe(e), async (tx) => {
        await tx.accesos.tomarRenovacion(
          empresaId(e.empresa),
          c,
          "wsfe",
          T0,
          new Date(T0.getTime() + 60_000),
        );
        return tx.accesos.guardarCredencial(empresaId(e.empresa), c, "wsfe", primera);
      });
      expect(guardada).toMatchObject({
        tieneCredencial: true,
        generadoEn: primera.generadoEn,
        expiraEn: primera.expiraEn,
        renovandoHasta: null,
        // 1 al crear la fila, 2 al tomar la renovación, 3 al guardar la credencial.
        version: 3,
      });
      const leida = await correr(comoSistemaDe(e), (tx) =>
        tx.accesos.obtenerCredencial(empresaId(e.empresa), c, "wsfe"),
      );
      expect(
        Buffer.from(leida?.credencial.cifrado ?? []).equals(
          Buffer.from(primera.credencial.cifrado),
        ),
      ).toBe(true);
      expect(
        Buffer.from(leida?.credencial.nonce ?? []).equals(Buffer.from(primera.credencial.nonce)),
      ).toBe(true);
      expect(
        Buffer.from(leida?.credencial.etiqueta ?? []).equals(
          Buffer.from(primera.credencial.etiqueta),
        ),
      ).toBe(true);
      expect(leida).toMatchObject({ generadoEn: primera.generadoEn, expiraEn: primera.expiraEn });
      const segunda = credencial(new Date(T0.getTime() + 13 * 3_600_000));
      await correr(comoSistemaDe(e), (tx) =>
        tx.accesos.guardarCredencial(empresaId(e.empresa), c, "wsfe", segunda),
      );
      const pisada = await correr(comoSistemaDe(e), (tx) =>
        tx.accesos.obtenerCredencial(empresaId(e.empresa), c, "wsfe"),
      );
      expect(
        Buffer.from(pisada?.credencial.cifrado ?? []).equals(
          Buffer.from(segunda.credencial.cifrado),
        ),
      ).toBe(true);
      // Un caché, no historia: sigue habiendo una sola fila.
      expect(
        (await consultar("select 1 from acceso_arca where certificado_id = $1", [c])).length,
      ).toBe(1);
    });

    it("la renovación se toma de a una: la segunda no la consigue hasta que la primera vence o termina", async () => {
      const { e, c } = await conCertificado();
      await correr(comoSistemaDe(e), (tx) => tx.accesos.asegurar(empresaId(e.empresa), c, "wsfe"));
      const hasta = new Date(T0.getTime() + 60_000);
      const tomar = (ahora: Date, h: Date) =>
        correr(comoSistemaDe(e), (tx) =>
          tx.accesos.tomarRenovacion(empresaId(e.empresa), c, "wsfe", ahora, h),
        );
      expect(await tomar(T0, hasta)).toBe(true);
      expect(await tomar(new Date(T0.getTime() + 30_000), new Date(T0.getTime() + 90_000))).toBe(
        false,
      );
      // En el instante exacto en que vence la toma (`renovando_hasta <= ahora`), otra puede tomarla.
      expect(await tomar(new Date(hasta.getTime() - 1), new Date(hasta.getTime() + 60_000))).toBe(
        false,
      );
      expect(await tomar(hasta, new Date(hasta.getTime() + 60_000))).toBe(true);
      // Terminar (guardar la credencial) la suelta.
      await correr(comoSistemaDe(e), (tx) =>
        tx.accesos.guardarCredencial(empresaId(e.empresa), c, "wsfe", credencial(T0)),
      );
      expect(await tomar(T0, hasta)).toBe(true);
      // Hasta tiene que ser posterior a ahora.
      await expect(tomar(T0, T0)).rejects.toThrow(/posterior/);
      await expect(tomar(T0, new Date(T0.getTime() - 1))).rejects.toThrow(/posterior/);
      // Sin fila no hay nada que tomar.
      expect(
        await correr(comoSistemaDe(e), (tx) =>
          tx.accesos.tomarRenovacion(
            empresaId(e.empresa),
            certificadoId(randomUUID()),
            "wsfe",
            T0,
            hasta,
          ),
        ),
      ).toBe(false);
    });

    it("sin fila no se guarda nada (null); y un vencimiento que no es posterior a la generación lo frena la base", async () => {
      const { e, c } = await conCertificado();
      expect(
        await correr(comoSistemaDe(e), (tx) =>
          tx.accesos.guardarCredencial(empresaId(e.empresa), c, "wsfe", credencial(T0)),
        ),
      ).toBeNull();
      await correr(comoSistemaDe(e), (tx) => tx.accesos.asegurar(empresaId(e.empresa), c, "wsfe"));
      const r = await intentar(comoSistemaDe(e), (tx) =>
        tx.accesos.guardarCredencial(empresaId(e.empresa), c, "wsfe", {
          ...credencial(T0),
          expiraEn: T0,
        }),
      );
      expect(r).toEqual(err({ tipo: "Check", restriccion: "acceso_completo_ck" }));
      // `acceso_completo_ck` no tiene error de negocio propio: sale tal cual, tipado.
      expect(traducirErroresDeFiscal(r, ["CERTIFICADO_NO_ENCONTRADO"])).toEqual(r);
      // Y un certificado que no existe no tiene acceso.
      const sinCertificado = await intentar(comoSistemaDe(e), (tx) =>
        tx.accesos.asegurar(empresaId(e.empresa), certificadoId(randomUUID()), "wsfe"),
      );
      expect(sinCertificado).toEqual(
        err({ tipo: "Referencia", restriccion: "acceso_certificado_fkey" }),
      );
      expect(traducirErroresDeFiscal(sinCertificado, ["CERTIFICADO_NO_ENCONTRADO"])).toEqual(
        err("CERTIFICADO_NO_ENCONTRADO"),
      );
    });

    it("aislamiento: otra empresa no ve, no toma la renovación ni guarda sobre el acceso ajeno", async () => {
      const { e, c } = await conCertificado();
      const b = await escenario({ mundo: await crearMundo(dueno, { tenant: e.tenant }) });
      await correr(comoSistemaDe(e), (tx) => tx.accesos.asegurar(empresaId(e.empresa), c, "wsfe"));
      const desdeB = await correr(comoSistemaDe(b), async (tx) => ({
        obtener: await tx.accesos.obtener(empresaId(e.empresa), c, "wsfe"),
        credencial: await tx.accesos.obtenerCredencial(empresaId(e.empresa), c, "wsfe"),
        tomar: await tx.accesos.tomarRenovacion(
          empresaId(e.empresa),
          c,
          "wsfe",
          T0,
          new Date(T0.getTime() + 1000),
        ),
        guardar: await tx.accesos.guardarCredencial(
          empresaId(e.empresa),
          c,
          "wsfe",
          credencial(T0),
        ),
      }));
      expect(desdeB).toEqual({ obtener: null, credencial: null, tomar: false, guardar: null });
      expect(
        (
          await consultar<{ r: Date | null }>(
            "select renovando_hasta as r from acceso_arca where certificado_id = $1",
            [c],
          )
        )[0],
      ).toEqual({ r: null });
    });
  });

  // ===============================================================================================
  // Intentos
  // ===============================================================================================
  describe("intentos contra ARCA", () => {
    const conComprobante = async () => {
      const e = await escenario();
      const alta = altaDe(e);
      await correr(comoPersonaDe(e), (tx) => tx.comprobantes.crear(alta));
      return { e, id: alta.id };
    };

    it("se guarda lo que respondió ARCA (códigos, textos, número grande, respuesta y duración) y vuelve igual", async () => {
      const { e, id } = await conComprobante();
      const intento = intentoDe(e, id, {
        numero: 99_999_999n,
        mensajes: [
          {
            clase: "ERROR",
            codigo: 10016,
            texto: "El número o fecha del comprobante no corresponde al próximo a autorizar",
          },
          { clase: "OBSERVACION", codigo: 10237, texto: "Ñandú «observado» ✓" },
          { clase: "EVENTO", codigo: 0, texto: "" },
        ],
        desenlace: "RECHAZADO",
      });
      const r = exito(await correr(comoSistemaDe(e), (tx) => tx.intentos.registrar(intento)));
      expect(r).toEqual({ creado: true, valor: intento });
      expect(
        await correr(comoSistemaDe(e), (tx) =>
          tx.intentos.delComprobante(empresaId(e.empresa), id),
        ),
      ).toEqual([intento]);
      // Sin mensajes, sin número, sin respuesta ni huella: todo opcional.
      const minimo = intentoDe(e, id, {
        operacion: "ULTIMO_AUTORIZADO",
        numero: null,
        desenlace: "RESPONDIDO",
        mensajes: [],
        respuesta: null,
        huellaDelPedido: null,
        duracionEnMs: 0,
      });
      expect(
        exito(await correr(comoSistemaDe(e), (tx) => tx.intentos.registrar(minimo))).valor,
      ).toEqual(minimo);
    });

    it("repetir el mismo intento es un éxito sin escribir; el mismo id con otro contenido, o de otra empresa, es ID_EN_USO", async () => {
      const { e, id } = await conComprobante();
      const otra = await escenario();
      const intento = intentoDe(e, id);
      await correr(comoSistemaDe(e), (tx) => tx.intentos.registrar(intento));
      expect(exito(await correr(comoSistemaDe(e), (tx) => tx.intentos.registrar(intento)))).toEqual(
        { creado: false, valor: intento },
      );
      for (const distinto of [
        { desenlace: "RECHAZADO" as const },
        { numero: 2n },
        { duracionEnMs: 1 },
        { respuesta: "<otra/>" },
        { mensajes: [] },
        { iniciadoEn: new Date("2026-10-12T12:00:00.001Z") },
        { huellaDelPedido: null },
      ]) {
        expect(
          await correr(comoSistemaDe(e), (tx) =>
            tx.intentos.registrar({ ...intento, ...distinto }),
          ),
          JSON.stringify(distinto, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)),
        ).toEqual(err("ID_EN_USO"));
      }
      expect(
        await correr(comoSistemaDe(otra), (tx) =>
          tx.intentos.registrar({
            ...intentoDe(otra, comprobanteId(randomUUID())),
            id: intento.id,
          }),
        ),
      ).toEqual(err("ID_EN_USO"));
      expect(
        (await consultar("select 1 from intento_arca where empresa_id = $1", [e.empresa])).length,
      ).toBe(1);
    });

    it("se leen por orden de inicio y, a igual instante, por id", async () => {
      const { e, id } = await conComprobante();
      const t = (min: number) => new Date(Date.UTC(2026, 9, 12, 12, min));
      const tarde = intentoDe(e, id, { iniciadoEn: t(5) });
      const temprano = intentoDe(e, id, { iniciadoEn: t(1) });
      const [a, b] = [
        intentoDe(e, id, { iniciadoEn: t(3) }),
        intentoDe(e, id, { iniciadoEn: t(3) }),
      ].sort((x, y) => (x.id < y.id ? -1 : 1));
      for (const i of [tarde, b!, temprano, a!])
        await correr(comoSistemaDe(e), (tx) => tx.intentos.registrar(i));
      expect(
        (
          await correr(comoSistemaDe(e), (tx) =>
            tx.intentos.delComprobante(empresaId(e.empresa), id),
          )
        ).map((i) => i.id),
      ).toEqual([temprano.id, a!.id, b!.id, tarde.id]);
    });

    it("una respuesta con una credencial (Token, Sign o un PEM) no se guarda: es un defecto del adaptador y no llega a la base", async () => {
      const { e, id } = await conComprobante();
      for (const respuesta of [
        "<loginTicketResponse><credentials><token>abc</token></credentials></loginTicketResponse>",
        "<Token>abc</Token>",
        "<ns1:Sign>abc</ns1:Sign>",
        "<TOKEN >abc",
        "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----",
        "x -----BEGIN CERTIFICATE-----",
      ]) {
        await expect(
          correr(comoSistemaDe(e), (tx) => tx.intentos.registrar(intentoDe(e, id, { respuesta }))),
          respuesta,
        ).rejects.toThrow(/credencial/);
      }
      // Control: hablar de un token en un texto no es una credencial.
      const inocente = intentoDe(e, id, {
        respuesta: "<Msg>No hace falta un token ni un sign para FEDummy</Msg>",
      });
      expect(
        exito(await correr(comoSistemaDe(e), (tx) => tx.intentos.registrar(inocente))).creado,
      ).toBe(true);
      expect(
        (await consultar("select 1 from intento_arca where empresa_id = $1", [e.empresa])).length,
      ).toBe(1);
    });

    it("la respuesta cabe hasta 64 KB: 65536 bytes entran y uno más lo frena la base", async () => {
      const { e, id } = await conComprobante();
      const justo = intentoDe(e, id, { respuesta: "a".repeat(65_536) });
      expect(
        exito(await correr(comoSistemaDe(e), (tx) => tx.intentos.registrar(justo))).creado,
      ).toBe(true);
      const r = await intentar(comoSistemaDe(e), (tx) =>
        tx.intentos.registrar(intentoDe(e, id, { respuesta: "a".repeat(65_537) })),
      );
      expect(r).toEqual(err({ tipo: "Check", restriccion: "intento_respuesta_ck" }));
    });

    it("cada operación termina de una de sus maneras, y un intento es de UN comprobante de esta empresa", async () => {
      const { e, id } = await conComprobante();
      const mal = await intentar(comoSistemaDe(e), (tx) =>
        tx.intentos.registrar(
          intentoDe(e, id, { operacion: "CONSULTAR", desenlace: "AUTORIZADO" }),
        ),
      );
      expect(mal).toEqual(err({ tipo: "Check", restriccion: "intento_operacion_desenlace_ck" }));
      const otra = await escenario();
      const ajeno = await intentar(comoSistemaDe(otra), (tx) =>
        tx.intentos.registrar(intentoDe(otra, id)),
      );
      expect(ajeno).toEqual(err({ tipo: "Referencia", restriccion: "intento_comprobante_fkey" }));
      expect(traducirErroresDeFiscal(ajeno, ["COMPROBANTE_NO_ENCONTRADO"])).toEqual(
        err("COMPROBANTE_NO_ENCONTRADO"),
      );
    });

    it("es de SOLO INSERCIÓN: la aplicación no puede cambiar ni borrar un intento, ni vaciar la tabla", async () => {
      const { e, id } = await conComprobante();
      const intento = intentoDe(e, id);
      await correr(comoSistemaDe(e), (tx) => tx.intentos.registrar(intento));
      for (const sentencia of [
        (tx: TxFacturacionDePrueba) => sql`update intento_arca set duracion_ms = 0`.execute(tx.db),
        (tx: TxFacturacionDePrueba) => sql`delete from intento_arca`.execute(tx.db),
        (tx: TxFacturacionDePrueba) => sql`truncate intento_arca`.execute(tx.db),
      ]) {
        expect(await intentar(comoSistemaDe(e), sentencia)).toEqual(
          err({ tipo: "AccesoDenegado" }),
        );
      }
      expect(
        await correr(comoSistemaDe(e), (tx) =>
          tx.intentos.delComprobante(empresaId(e.empresa), id),
        ),
      ).toEqual([intento]);
    });

    it("aislamiento: otra empresa (también del mismo tenant) no ve los intentos ni los pisa", async () => {
      const { e, id } = await conComprobante();
      const b = await escenario({ mundo: await crearMundo(dueno, { tenant: e.tenant }) });
      const intento = intentoDe(e, id);
      await correr(comoSistemaDe(e), (tx) => tx.intentos.registrar(intento));
      expect(
        await correr(comoSistemaDe(b), (tx) =>
          tx.intentos.delComprobante(empresaId(e.empresa), id),
        ),
      ).toEqual([]);
      expect(
        await correr(comoSistemaDe(b), (tx) =>
          tx.intentos.registrar({ ...intento, empresaId: empresaId(b.empresa) }),
        ),
      ).toEqual(err("ID_EN_USO"));
      expect(intentoId(intento.id)).toBe(intento.id);
    });
  });
});

import { createHash, randomUUID, X509Certificate } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  certificadoId,
  dondeSeGuardaLaClave,
  type SalidaDeGenerarPedido,
} from "../../src/modulos/fiscal/publico";
import { crearCifradorAesGcm } from "../../src/adaptadores/cifrado/aes-gcm";
import { empresaId } from "../../src/primitivas/identificadores/marca";
import { campoConPosibleSecreto, type Dato } from "../../src/puertos/sin-secretos";
import { crearBaseAparte } from "./entorno";
import {
  casosDeCertificados,
  certificadoDeArca,
  clavesMaestrasDePrueba,
  crearEntornoDeCertificados,
  crearServicios,
  cuitConPrefijo,
  escenarioDeSociedad,
  pedidoDeCertificado,
  type ServiciosDePrueba,
} from "./certificados-apoyo";
import { crearMembresiaDeBase } from "./fixtures-identidad";

/**
 * H7 facturación, tramo F7: los casos de uso de certificados (generar el pedido y cargar el certificado) contra una
 * base real, con el rol limitado de la aplicación y el contexto firmado (el dueño de la base solo arma escenarios y
 * mira). Los servicios son los reales (AES-256-GCM, pkijs, node:crypto) con claves y autoridades de la propia prueba.
 * Lo que se vigila en TODO resultado: que la clave privada generada no aparezca en ningún error, respuesta, auditoría
 * ni columna que no sea la cifrada. La concurrencia está en `certificados-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

type Fila = Record<string, unknown>;
const DIA = 86_400_000;
const OTRO_CUIT_VALIDO = "30703088534";
/** El `serialNumber` del sujeto como lo escribe ARCA en el certificado. */
const SERIE_DE = (cuit: string) => `CUIT ${cuit}`;

describe.skipIf(base === null)("certificados F7: casos de uso contra una base real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDeCertificados>;
  let servicios: ServiciosDePrueba;
  let casos: ReturnType<typeof casosDeCertificados>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDeCertificados(propia.base, 8);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    servicios = await crearServicios();
    casos = casosDeCertificados(entorno, servicios);
  }, 120_000);
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const certificado = async (id: string) =>
    (
      await filas<{
        estado: string;
        alias: string;
        ambiente: string;
        cuit_titular: string;
        huella: string | null;
        vence: Date | null;
        pem: string | null;
        pedido: string;
        kid: string;
        creado_por: string;
        version: number;
      }>(
        `select estado, alias, ambiente, cuit_titular, huella_sha256 as huella, vence_en as vence,
                certificado_pem as pem, pedido_pem as pedido, clave_kid as kid, creado_por, version
           from certificado_arca where id = $1`,
        [id],
      )
    )[0];
  const vigentes = async (e: { empresa: string; emisor: string }, ambiente = "HOMOLOGACION") =>
    (
      await filas<{ n: number }>(
        `select count(*)::int as n from certificado_arca
          where empresa_id = $1 and emisor_id = $2 and ambiente = $3 and estado = 'VIGENTE'`,
        [e.empresa, e.emisor, ambiente],
      )
    )[0]?.n;
  const auditorias = async (empresa: string, entidadId: string) =>
    await filas<{ accion: string; actor: string | null; antes: Dato; despues: Dato }>(
      `select accion, actor_persona_id as actor, antes, despues from auditoria_empresa
        where empresa_id = $1 and entidad_id = $2 order by id`,
      [empresa, entidadId],
    );
  const claveCifrada = async (id: string) =>
    (
      await filas<{ c: Buffer }>("select clave_cifrada as c from certificado_arca where id = $1", [
        id,
      ])
    )[0]?.c;
  const cuerpoDe = (pem: string) =>
    pem
      .split("\n")
      .filter((l) => !l.startsWith("-----"))
      .join("");

  /**
   * Ninguna de las claves privadas generadas hasta ahora aparece, en claro o en base64, en `dato` (una respuesta, un
   * error o un volcado). Nombra qué buscó para que un fallo diga dónde.
   */
  const sinLaClave = (dato: unknown) => {
    const texto = JSON.stringify(dato, (_k, v: unknown) => (typeof v === "bigint" ? `${v}n` : v));
    expect(texto).not.toContain("PRIVATE");
    for (const clave of servicios.clavesGeneradas) {
      expect(texto).not.toContain(cuerpoDe(clave).slice(0, 40));
    }
  };

  async function preparar(
    opciones: { rol?: "GERENTE" | "ADMINISTRADOR" | "OPERADOR"; sociedad?: boolean } = {},
  ) {
    // `sociedad`: la empresa que factura tiene CUIT 30-… y el certificado lo saca una persona física (D-42).
    const e =
      opciones.sociedad === true
        ? await escenarioDeSociedad(dueno, propia.base)
        : await crearEscenarioDeCasosConRol(opciones.rol ?? "GERENTE");
    return {
      e,
      como: () => e.como(new Date()),
      generar: async (cambios: Parameters<typeof pedidoDeCertificado>[1] = {}) => {
        const entrada = pedidoDeCertificado(e, cambios);
        const r = await casos.generarPedidoDeCertificado(e.como(new Date()), entrada);
        sinLaClave(r);
        return { entrada, r };
      },
      /** Genera un pedido y falla la prueba si no se pudo. */
      pedir: async (cambios: Parameters<typeof pedidoDeCertificado>[1] = {}) => {
        const entrada = pedidoDeCertificado(e, cambios);
        const r = await casos.generarPedidoDeCertificado(e.como(new Date()), entrada);
        if (!r.ok) throw new Error(`no se generó el pedido: ${JSON.stringify(r.error)}`);
        return { entrada, salida: r.valor };
      },
      cargar: async (id: string, pem: string) => {
        const r = await casos.cargarCertificado(e.como(new Date()), {
          certificadoId: certificadoId(id),
          certificadoPem: pem,
        });
        sinLaClave(r);
        return r;
      },
    };
  }

  async function crearEscenarioDeCasosConRol(rol: "GERENTE" | "ADMINISTRADOR" | "OPERADOR") {
    const { crearEscenarioDeCasos } = await import("./facturacion-casos-apoyo");
    return crearEscenarioDeCasos(dueno, propia.base, { rol, sinCertificado: true });
  }

  // ===============================================================================================
  describe("generar el pedido", () => {
    it("guarda la clave cifrada atada a su fila, devuelve solo el pedido y audita el hecho sin el contenido", async () => {
      const p = await preparar();
      const antes = servicios.clavesGeneradas.length;
      const { entrada, r } = await p.generar();
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor).toEqual({
        certificadoId: entrada.id,
        pedidoPem: r.valor.pedidoPem,
        yaExistia: false,
      });
      expect(r.valor.pedidoPem).toMatch(/^-----BEGIN CERTIFICATE REQUEST-----\n/);
      expect(Object.keys(r.valor).sort()).toEqual(["certificadoId", "pedidoPem", "yaExistia"]);

      // Se generó UNA clave y se guardó una sola fila.
      expect(servicios.clavesGeneradas).toHaveLength(antes + 1);
      const generada = servicios.clavesGeneradas[antes] ?? "";
      const fila = await certificado(entrada.id);
      expect(fila).toMatchObject({
        estado: "PEDIDO_GENERADO",
        alias: entrada.alias,
        ambiente: "HOMOLOGACION",
        cuit_titular: p.e.cuit,
        pedido: r.valor.pedidoPem,
        kid: servicios.maestra.kid,
        creado_por: p.e.persona,
        huella: null,
        pem: null,
      });

      // Lo guardado es la clave CIFRADA: no es el PEM ni lo contiene, y descifra a la clave generada solo en SU lugar.
      const bytes = await claveCifrada(entrada.id);
      expect(bytes).toBeDefined();
      const guardado = bytes ?? Buffer.alloc(0);
      expect(guardado.toString("latin1")).not.toContain("PRIVATE");
      expect(guardado.includes(Buffer.from(cuerpoDe(generada).slice(0, 40)))).toBe(false);
      const empresa = empresaId(p.e.empresa);
      const repo = await entorno.ejecutar({ contexto: p.como() }, async (tx) => ({
        ok: true as const,
        valor: await tx.certificados.obtenerClave(empresa, certificadoId(entrada.id)),
      }));
      const texto = repo.ok ? repo.valor : null;
      expect(texto?.kid).toBe(servicios.maestra.kid);
      if (texto === null) throw new Error("la clave guardada no se leyó");
      const lugar = dondeSeGuardaLaClave(empresa, certificadoId(entrada.id));
      expect(servicios.cifrador.descifrar(texto, lugar)?.revelar()).toBe(generada);
      // Atada a su fila: en otra fila, en otra empresa o en otra columna no descifra.
      expect(servicios.cifrador.descifrar(texto, { ...lugar, filaId: randomUUID() })).toBeNull();
      expect(
        servicios.cifrador.descifrar(texto, { ...lugar, empresaId: empresaId(randomUUID()) }),
      ).toBeNull();
      expect(
        servicios.cifrador.descifrar(texto, { ...lugar, columna: "credencial_cifrada" }),
      ).toBeNull();

      // Auditoría: el hecho (quién, qué, alias), nunca el contenido.
      const aud = await auditorias(p.e.empresa, entrada.id);
      expect(aud.map((a) => a.accion)).toEqual(["CERTIFICADO_PEDIDO_GENERADO"]);
      expect(aud[0]?.actor).toBe(p.e.persona);
      expect(aud[0]?.despues).toEqual({
        estado: "PEDIDO_GENERADO",
        emisorId: p.e.emisor,
        ambiente: "HOMOLOGACION",
        alias: entrada.alias,
        cuitTitular: p.e.cuit,
      });
      expect(campoConPosibleSecreto(aud[0]?.despues ?? null)).toBeNull();
      sinLaClave(aud);
    });

    it("la clave y el pedido no están en ningún otro lado de la base (la auditoría, los trabajos, el resto de las columnas)", async () => {
      const p = await preparar();
      const antes = servicios.clavesGeneradas.length;
      const { entrada } = await p.pedir();
      const cuerpo = cuerpoDe(servicios.clavesGeneradas[antes] ?? "").slice(0, 40);
      expect(cuerpo.length).toBe(40);
      const volcado = await filas<{ t: string }>(
        `select to_jsonb(a)::text as t from auditoria_empresa a where empresa_id = $1
         union all select to_jsonb(t)::text from trabajo t where empresa_id = $1
         union all select (to_jsonb(c) - 'clave_cifrada')::text from certificado_arca c where id = $2`,
        [p.e.empresa, entrada.id],
      );
      expect(volcado.length).toBeGreaterThan(0);
      for (const { t } of volcado) {
        expect(t).not.toContain(cuerpo);
        expect(t).not.toContain("PRIVATE");
      }
    });

    it("repetir con la misma clave devuelve el mismo pedido, SIN generar otra clave, ni escribir ni auditar", async () => {
      const p = await preparar();
      const { entrada, salida } = await p.pedir();
      const claves = servicios.clavesGeneradas.length;
      const cifrado = (await claveCifrada(entrada.id))?.toString("hex");
      const version = (await certificado(entrada.id))?.version;

      const repetido = await casos.generarPedidoDeCertificado(p.como(), entrada);
      expect(repetido).toEqual({
        ok: true,
        valor: { certificadoId: entrada.id, pedidoPem: salida.pedidoPem, yaExistia: true },
      });
      // El mismo pedido con el CUIT con guiones es el mismo pedido.
      const conGuiones = `${p.e.cuit.slice(0, 2)}-${p.e.cuit.slice(2, 10)}-${p.e.cuit.slice(10)}`;
      expect(
        await casos.generarPedidoDeCertificado(p.como(), { ...entrada, cuitTitular: conGuiones }),
      ).toMatchObject({
        ok: true,
        valor: { yaExistia: true },
      });
      expect(servicios.clavesGeneradas).toHaveLength(claves);
      expect((await claveCifrada(entrada.id))?.toString("hex")).toBe(cifrado);
      expect((await certificado(entrada.id))?.version).toBe(version);
      expect(
        await filas("select 1 from certificado_arca where id = $1", [entrada.id]),
      ).toHaveLength(1);
      expect(await auditorias(p.e.empresa, entrada.id)).toHaveLength(1);
    });

    it("la misma clave con otro pedido (otro alias o otro ambiente) es CLAVE_REUTILIZADA y no toca nada", async () => {
      const p = await preparar();
      const { entrada } = await p.pedir();
      const claves = servicios.clavesGeneradas.length;
      for (const cambio of [{ alias: "otroalias" }, { ambiente: "PRODUCCION" as const }]) {
        const r = await casos.generarPedidoDeCertificado(p.como(), { ...entrada, ...cambio });
        expect(r).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
      }
      expect(servicios.clavesGeneradas).toHaveLength(claves);
      expect((await certificado(entrada.id))?.alias).toBe(entrada.alias);
      expect(await auditorias(p.e.empresa, entrada.id)).toHaveLength(1);
    });

    it("un pedido malo da su error con nombre, no genera ninguna clave y no deja nada", async () => {
      const p = await preparar();
      const claves = servicios.clavesGeneradas.length;
      const casosMalos: [string, Parameters<typeof pedidoDeCertificado>[1]][] = [
        ["ID_INVALIDO", { id: "no-es-un-uuid" }],
        ["ALIAS_INVALIDO", { alias: "con espacio" }],
        ["CUIT_INVALIDO", { cuitTitular: "20123456787" }],
        ["ORGANIZACION_INVALIDA", { organizacion: "   " }],
        ["EMISOR_NO_ENCONTRADO", { emisorId: randomUUID() as never }],
      ];
      for (const [error, cambios] of casosMalos) {
        const r = await casos.generarPedidoDeCertificado(
          p.como(),
          pedidoDeCertificado(p.e, cambios),
        );
        expect(r, error).toEqual({ ok: false, error });
      }
      expect(servicios.clavesGeneradas).toHaveLength(claves);
      expect(
        await filas("select 1 from certificado_arca where empresa_id = $1", [p.e.empresa]),
      ).toHaveLength(0);
      expect(
        await filas(
          "select 1 from auditoria_empresa where empresa_id = $1 and accion like 'CERTIFICADO%'",
          [p.e.empresa],
        ),
      ).toHaveLength(0);
    });

    it.each(["ADMINISTRADOR", "OPERADOR"] as const)(
      "un %s no puede (SIN_PERMISO): no genera clave, no escribe",
      async (rol) => {
        const p = await preparar({ rol });
        const claves = servicios.clavesGeneradas.length;
        const { r } = await p.generar();
        expect(r).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(servicios.clavesGeneradas).toHaveLength(claves);
        expect(
          await filas("select 1 from certificado_arca where empresa_id = $1", [p.e.empresa]),
        ).toHaveLength(0);
      },
    );

    it("el pedido de una empresa no lo ve otra: repetir su clave en otra empresa es CLAVE_REUTILIZADA y no toca el original", async () => {
      const a = await preparar();
      const b = await preparar();
      const { entrada, salida } = await a.pedir();
      const r = await casos.generarPedidoDeCertificado(b.como(), {
        ...pedidoDeCertificado(b.e),
        id: entrada.id,
      });
      expect(r).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
      expect((await certificado(entrada.id))?.pedido).toBe(salida.pedidoPem);
      expect(
        await filas("select 1 from certificado_arca where empresa_id = $1", [b.e.empresa]),
      ).toHaveLength(0);
    });

    it("una falla de la base después de generar la clave no la deja en el error ni en ninguna fila", async () => {
      const p = await preparar();
      // El cifrador devuelve un `kid` de 101 caracteres que la base rechaza (`certificado_kid_ck`): el alta falla con la clave ya generada.
      const malo = casosDeCertificados(entorno, {
        ...servicios,
        cifrador: {
          cifrar: (secreto, donde) => ({
            ...servicios.cifrador.cifrar(secreto, donde),
            kid: "k".repeat(101),
          }),
          descifrar: (t, d) => servicios.cifrador.descifrar(t, d),
        },
      });
      const claves = servicios.clavesGeneradas.length;
      const entrada = pedidoDeCertificado(p.e);
      const r = await malo.generarPedidoDeCertificado(p.como(), entrada);
      expect(r).toEqual({ ok: false, error: { tipo: "Check", restriccion: "certificado_kid_ck" } });
      expect(servicios.clavesGeneradas).toHaveLength(claves + 1);
      sinLaClave(r);
      expect(await certificado(entrada.id)).toBeUndefined();
      expect(await auditorias(p.e.empresa, entrada.id)).toHaveLength(0);
    });

    it("un fallo de conexión (un rol que no existe) no deja la clave en el error", async () => {
      const p = await preparar();
      const url = new URL(propia.base.app);
      url.username = `rol_que_no_existe_${randomUUID().slice(0, 8)}`;
      const roto = crearEntornoDeCertificados({ ...propia.base, app: url.toString() }, 2);
      try {
        const claves = servicios.clavesGeneradas.length;
        const intento = casosDeCertificados(roto, servicios).generarPedidoDeCertificado(
          p.como(),
          pedidoDeCertificado(p.e),
        );
        const resultado = await intento.then(
          (r) => r,
          (e: unknown) => ({
            lanzado: e instanceof Error ? `${e.name}: ${e.message}` : "no es un Error",
          }),
        );
        sinLaClave(resultado);
        // Sin conexión no hubo transacción: no se llegó a generar ninguna clave.
        expect(servicios.clavesGeneradas).toHaveLength(claves);
        expect(
          await filas("select 1 from certificado_arca where empresa_id = $1", [p.e.empresa]),
        ).toHaveLength(0);
      } finally {
        await roto.cerrar();
      }
    });
  });

  // ===============================================================================================
  describe("cargar el certificado", () => {
    const certificadoValido = async (
      pedido: SalidaDeGenerarPedido,
      opciones: Parameters<typeof certificadoDeArca>[3] = {},
      ambiente: "HOMOLOGACION" | "PRODUCCION" = "HOMOLOGACION",
    ) => certificadoDeArca(servicios, ambiente, pedido.pedidoPem, opciones);

    it("pasa el pedido a VIGENTE con la huella y el vencimiento del certificado, y audita el hecho sin el contenido", async () => {
      const p = await preparar();
      const { entrada, salida } = await p.pedir();
      const noDespues = new Date(Date.now() + 700 * DIA);
      noDespues.setMilliseconds(0);
      const pem = await certificadoValido(salida, { noDespues });
      const r = await p.cargar(entrada.id, pem);
      expect(r).toEqual({
        ok: true,
        valor: { vence: noDespues, reemplazoA: null, yaEstaba: false },
      });

      const fila = await certificado(entrada.id);
      expect(fila).toMatchObject({
        estado: "VIGENTE",
        huella: createHash("sha256").update(new X509Certificate(pem).raw).digest("hex"),
      });
      expect(fila?.vence?.getTime()).toBe(noDespues.getTime());
      expect(new X509Certificate(fila?.pem ?? "").fingerprint256).toBe(
        new X509Certificate(pem).fingerprint256,
      );

      const aud = await auditorias(p.e.empresa, entrada.id);
      expect(aud.map((a) => a.accion)).toEqual([
        "CERTIFICADO_PEDIDO_GENERADO",
        "CERTIFICADO_CARGADO",
      ]);
      expect(aud[1]).toMatchObject({
        actor: p.e.persona,
        antes: { estado: "PEDIDO_GENERADO" },
        despues: {
          estado: "VIGENTE",
          alias: entrada.alias,
          ambiente: "HOMOLOGACION",
          vence: noDespues.toISOString(),
          huella: fila?.huella,
        },
      });
      expect(campoConPosibleSecreto(aud[1]?.despues ?? null)).toBeNull();
      sinLaClave(aud);
    });

    it("cargar otro para el mismo emisor y ambiente reemplaza al vigente en la misma transacción (reemplazoA) y deja uno solo", async () => {
      const p = await preparar();
      const primero = await p.pedir();
      expect((await p.cargar(primero.entrada.id, await certificadoValido(primero.salida))).ok).toBe(
        true,
      );
      const segundo = await p.pedir();
      const r = await p.cargar(segundo.entrada.id, await certificadoValido(segundo.salida));
      expect(r).toMatchObject({
        ok: true,
        valor: { reemplazoA: primero.entrada.id, yaEstaba: false },
      });
      expect((await certificado(primero.entrada.id))?.estado).toBe("REEMPLAZADO");
      expect((await certificado(segundo.entrada.id))?.estado).toBe("VIGENTE");
      expect(await vigentes(p.e)).toBe(1);
      expect((await auditorias(p.e.empresa, primero.entrada.id)).map((a) => a.accion)).toEqual([
        "CERTIFICADO_PEDIDO_GENERADO",
        "CERTIFICADO_CARGADO",
        "CERTIFICADO_REEMPLAZADO",
      ]);
      expect((await auditorias(p.e.empresa, primero.entrada.id))[2]).toMatchObject({
        antes: { estado: "VIGENTE" },
        despues: { estado: "REEMPLAZADO", reemplazadoPor: segundo.entrada.id },
      });
    });

    it("un certificado de producción no reemplaza al de homologación: cada ambiente tiene el suyo", async () => {
      const p = await preparar();
      const homo = await p.pedir();
      await p.cargar(homo.entrada.id, await certificadoValido(homo.salida));
      const prod = await p.pedir({ ambiente: "PRODUCCION" });
      const r = await p.cargar(
        prod.entrada.id,
        await certificadoValido(prod.salida, {}, "PRODUCCION"),
      );
      expect(r).toMatchObject({ ok: true, valor: { reemplazoA: null } });
      expect(await vigentes(p.e, "HOMOLOGACION")).toBe(1);
      expect(await vigentes(p.e, "PRODUCCION")).toBe(1);
    });

    it("repetir la carga del mismo certificado (aunque llegue con otro formato) devuelve lo mismo, sin escribir ni auditar", async () => {
      const p = await preparar();
      const { entrada, salida } = await p.pedir();
      const pem = await certificadoValido(salida);
      const primera = await p.cargar(entrada.id, pem);
      expect(primera.ok).toBe(true);
      const version = (await certificado(entrada.id))?.version;
      const auditadas = (await auditorias(p.e.empresa, entrada.id)).length;
      const conOtroFormato = `\r\n  ${pem.replace(/\n/g, "\r\n")}  \r\n`;
      for (const texto of [pem, conOtroFormato]) {
        const repetida = await p.cargar(entrada.id, texto);
        expect(repetida).toEqual({
          ok: true,
          valor: {
            vence: primera.ok ? primera.valor.vence : null,
            reemplazoA: null,
            yaEstaba: true,
          },
        });
      }
      expect((await certificado(entrada.id))?.version).toBe(version);
      expect(await auditorias(p.e.empresa, entrada.id)).toHaveLength(auditadas);
      // Tampoco cambia nada si, entretanto, otro certificado lo reemplazó.
      const otro = await p.pedir();
      await p.cargar(otro.entrada.id, await certificadoValido(otro.salida));
      expect((await certificado(entrada.id))?.estado).toBe("REEMPLAZADO");
      expect(await p.cargar(entrada.id, pem)).toMatchObject({
        ok: true,
        valor: { yaEstaba: true },
      });
    });

    describe("lo que no sirve da su error con nombre y no cambia nada", () => {
      const intacto = async (p: Awaited<ReturnType<typeof preparar>>, id: string) => {
        expect(await certificado(id)).toMatchObject({
          estado: "PEDIDO_GENERADO",
          huella: null,
          pem: null,
          vence: null,
          version: 1,
        });
        expect((await auditorias(p.e.empresa, id)).map((a) => a.accion)).toEqual([
          "CERTIFICADO_PEDIDO_GENERADO",
        ]);
        expect(await vigentes(p.e)).toBe(0);
      };

      it("un texto que no es un certificado, o una clave privada pegada por error: CERTIFICADO_ILEGIBLE, sin repetir lo pegado", async () => {
        const p = await preparar();
        const { entrada } = await p.pedir();
        const clavePegada = servicios.clavesGeneradas.at(-1) ?? "";
        for (const texto of [
          "",
          "basura",
          clavePegada,
          `${clavePegada}\n${await certificadoValido((await p.pedir()).salida)}`,
        ]) {
          const r = await p.cargar(entrada.id, texto);
          expect(r).toEqual({ ok: false, error: "CERTIFICADO_ILEGIBLE" });
        }
        await intacto(p, entrada.id);
      });

      it("el certificado de OTRO pedido: NO_CORRESPONDE_A_LA_CLAVE (el mismo alias no lo ata)", async () => {
        const p = await preparar();
        const a = await p.pedir({ alias: "mismoalias" });
        const b = await p.pedir({ alias: "mismoalias" });
        const deB = await certificadoValido(b.salida);
        expect(await p.cargar(a.entrada.id, deB)).toEqual({
          ok: false,
          error: "NO_CORRESPONDE_A_LA_CLAVE",
        });
        await intacto(p, a.entrada.id);
        // Y cargado donde corresponde, sirve.
        expect((await p.cargar(b.entrada.id, deB)).ok).toBe(true);
      });

      it.each([
        ["de otro CUIT", `CUIT ${OTRO_CUIT_VALIDO}`],
        ["sin CUIT en el sujeto", null],
        ["con el CUIT con guiones", "CUIT 20-12345678-6"],
      ])("un certificado %s: NO_CORRESPONDE_AL_TITULAR", async (_nombre, numeroDeSerie) => {
        const p = await preparar();
        const { entrada, salida } = await p.pedir();
        const pem = await certificadoValido(salida, { numeroDeSerie });
        expect(await p.cargar(entrada.id, pem)).toEqual({
          ok: false,
          error: "NO_CORRESPONDE_AL_TITULAR",
        });
        await intacto(p, entrada.id);
      });

      it("un certificado de la cadena del otro ambiente, o de una autoridad desconocida: CADENA_NO_CONFIABLE", async () => {
        const p = await preparar();
        const { entrada, salida } = await p.pedir();
        // Emitido por la cadena de producción para un pedido de homologación.
        const deProduccion = await certificadoValido(salida, {}, "PRODUCCION");
        expect(await p.cargar(entrada.id, deProduccion)).toEqual({
          ok: false,
          error: "CADENA_NO_CONFIABLE",
        });
        const { crearAutoridadRaiz, emitirCertificado } =
          await import("../utilidades/certificados-de-prueba");
        const desconocida = await emitirCertificado(
          await crearAutoridadRaiz("Autoridad Falsa"),
          salida.pedidoPem,
        );
        expect(await p.cargar(entrada.id, desconocida)).toEqual({
          ok: false,
          error: "CADENA_NO_CONFIABLE",
        });
        await intacto(p, entrada.id);
        // Un pedido de producción con el certificado de la cadena de homologación tampoco.
        const prod = await p.pedir({ ambiente: "PRODUCCION" });
        const deHomologacion = await certificadoValido(prod.salida, {}, "HOMOLOGACION");
        expect(await p.cargar(prod.entrada.id, deHomologacion)).toEqual({
          ok: false,
          error: "CADENA_NO_CONFIABLE",
        });
        expect(await vigentes(p.e, "PRODUCCION")).toBe(0);
      });

      it("un certificado vencido: CERTIFICADO_VENCIDO", async () => {
        const p = await preparar();
        const { entrada, salida } = await p.pedir();
        const vencido = await certificadoValido(salida, {
          noAntes: new Date(Date.now() - 800 * DIA),
          noDespues: new Date(Date.now() - DIA),
        });
        expect(await p.cargar(entrada.id, vencido)).toEqual({
          ok: false,
          error: "CERTIFICADO_VENCIDO",
        });
        await intacto(p, entrada.id);
      });

      it("un pedido que no existe, o es de otra empresa: CERTIFICADO_NO_ENCONTRADO", async () => {
        const a = await preparar();
        const b = await preparar();
        const { entrada, salida } = await a.pedir();
        const pem = await certificadoValido(salida);
        expect(await a.cargar(randomUUID(), pem)).toEqual({
          ok: false,
          error: "CERTIFICADO_NO_ENCONTRADO",
        });
        expect(await b.cargar(entrada.id, pem)).toEqual({
          ok: false,
          error: "CERTIFICADO_NO_ENCONTRADO",
        });
        await intacto(a, entrada.id);
      });

      it("otro certificado en un pedido ya cargado, o en uno descartado: PEDIDO_NO_PENDIENTE", async () => {
        const p = await preparar();
        const cargado = await p.pedir();
        await p.cargar(cargado.entrada.id, await certificadoValido(cargado.salida));
        const otroCertificado = await certificadoValido(cargado.salida);
        expect(await p.cargar(cargado.entrada.id, otroCertificado)).toEqual({
          ok: false,
          error: "PEDIDO_NO_PENDIENTE",
        });
        expect((await certificado(cargado.entrada.id))?.estado).toBe("VIGENTE");

        const descartado = await p.pedir();
        await dueno.query("update certificado_arca set estado = 'DESCARTADO' where id = $1", [
          descartado.entrada.id,
        ]);
        expect(
          await p.cargar(descartado.entrada.id, await certificadoValido(descartado.salida)),
        ).toEqual({
          ok: false,
          error: "PEDIDO_NO_PENDIENTE",
        });
        expect((await certificado(descartado.entrada.id))?.estado).toBe("DESCARTADO");
      });

      it("con otra clave maestra la clave guardada no se descifra: CLAVE_ILEGIBLE (y no se culpa a lo pegado)", async () => {
        const p = await preparar();
        const { entrada, salida } = await p.pedir();
        const otra = casosDeCertificados(entorno, {
          ...servicios,
          cifrador: crearCifradorAesGcm({ activa: clavesMaestrasDePrueba(servicios.maestra.kid) }),
        });
        const r = await otra.cargarCertificado(p.como(), {
          certificadoId: certificadoId(entrada.id),
          certificadoPem: await certificadoValido(salida),
        });
        expect(r).toEqual({ ok: false, error: "CLAVE_ILEGIBLE" });
        await intacto(p, entrada.id);
      });
    });

    // ===========================================================================================
    describe("D-42: el titular es una persona física y la empresa que factura, otra (una sociedad)", () => {
      const verificacion = async (id: string) =>
        (
          await filas<{ en: Date | null }>(
            "select autorizacion_verificada_en as en from certificado_arca where id = $1",
            [id],
          )
        )[0]?.en;

      it("el pedido guarda al titular aparte del emisor, lo escribe en el CSR y lo audita; repetirlo es el mismo pedido", async () => {
        const p = await preparar({ sociedad: true });
        const titular = cuitConPrefijo("20");
        expect(p.e.cuit.startsWith("30")).toBe(true);
        expect(titular).not.toBe(p.e.cuit);

        const { entrada, salida } = await p.pedir({ cuitTitular: titular });
        expect(await certificado(entrada.id)).toMatchObject({
          estado: "PEDIDO_GENERADO",
          cuit_titular: titular,
        });
        // El CSR (y el certificado que ARCA emite a partir de él) lleva el CUIT del TITULAR, no el de la sociedad.
        const sujeto = new X509Certificate(await certificadoValido(salida)).subject;
        expect(sujeto).toContain(SERIE_DE(titular));
        expect(sujeto).not.toContain(SERIE_DE(p.e.cuit));
        const aud = await auditorias(p.e.empresa, entrada.id);
        expect(aud.map((a) => a.accion)).toEqual(["CERTIFICADO_PEDIDO_GENERADO"]);
        expect(aud[0]?.despues).toMatchObject({ emisorId: p.e.emisor, cuitTitular: titular });
        // La clave privada del pedido no está en la respuesta ni en la auditoría.
        sinLaClave([salida, aud]);

        const claves = servicios.clavesGeneradas.length;
        const conGuiones = `${titular.slice(0, 2)}-${titular.slice(2, 10)}-${titular.slice(10)}`;
        for (const repetido of [titular, conGuiones]) {
          expect(
            await casos.generarPedidoDeCertificado(p.como(), { ...entrada, cuitTitular: repetido }),
          ).toEqual({
            ok: true,
            valor: { certificadoId: entrada.id, pedidoPem: salida.pedidoPem, yaExistia: true },
          });
        }
        expect(servicios.clavesGeneradas).toHaveLength(claves);
        // Con otro titular (por ejemplo el de la sociedad) ya es otro pedido con la misma clave.
        expect(
          await casos.generarPedidoDeCertificado(p.como(), { ...entrada, cuitTitular: p.e.cuit }),
        ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
        expect((await certificado(entrada.id))?.cuit_titular).toBe(titular);
        // Un titular que no es un CUIT válido sigue siendo CUIT_INVALIDO (la validación del CUIT es la de siempre).
        expect(
          await casos.generarPedidoDeCertificado(
            p.como(),
            pedidoDeCertificado(p.e, { cuitTitular: "20123456787" }),
          ),
        ).toEqual({ ok: false, error: "CUIT_INVALIDO" });
      });

      it("un certificado del titular, de la clave, con la cadena de su ambiente y vigente carga: queda VIGENTE y «autorización sin verificar»", async () => {
        const p = await preparar({ sociedad: true });
        const titular = cuitConPrefijo("20");
        const { entrada, salida } = await p.pedir({ cuitTitular: titular });
        const noDespues = new Date(Date.now() + 700 * DIA);
        noDespues.setMilliseconds(0);
        const pem = await certificadoValido(salida, { noDespues });

        const r = await p.cargar(entrada.id, pem);
        expect(r).toEqual({
          ok: true,
          valor: { vence: noDespues, reemplazoA: null, yaEstaba: false },
        });
        expect(await certificado(entrada.id)).toMatchObject({
          estado: "VIGENTE",
          cuit_titular: titular,
        });
        // La autorización de la sociedad no se puede ver en el certificado: queda sin verificar, y NO se llamó a ARCA.
        expect(await verificacion(entrada.id)).toBeNull();
        const auditadas = await auditorias(p.e.empresa, entrada.id);
        expect(auditadas.map((a) => a.accion)).toEqual([
          "CERTIFICADO_PEDIDO_GENERADO",
          "CERTIFICADO_CARGADO",
        ]);
        sinLaClave(auditadas);
        expect(campoConPosibleSecreto(auditadas[1]?.despues ?? null)).toBeNull();

        // Repetir la carga (aunque llegue con otro formato) devuelve lo mismo y no escribe ni audita.
        const version = (await certificado(entrada.id))?.version;
        for (const texto of [pem, `\r\n ${pem.replace(/\n/g, "\r\n")} \r\n`]) {
          expect(await p.cargar(entrada.id, texto)).toEqual({
            ok: true,
            valor: { vence: noDespues, reemplazoA: null, yaEstaba: true },
          });
        }
        expect((await certificado(entrada.id))?.version).toBe(version);
        expect(await auditorias(p.e.empresa, entrada.id)).toHaveLength(2);
        expect(await verificacion(entrada.id)).toBeNull();
      });

      it("si el emisor es una persona física que se factura a sí misma, ambos CUIT coinciden y carga igual", async () => {
        const p = await preparar();
        const { entrada, salida } = await p.pedir({ cuitTitular: p.e.cuit });
        expect((await p.cargar(entrada.id, await certificadoValido(salida))).ok).toBe(true);
        expect((await certificado(entrada.id))?.cuit_titular).toBe(p.e.cuit);
      });

      it("con el titular declarado, lo que no sirve da su error y no cambia nada: otro serialNumber, vencido, cadena ajena y clave ajena", async () => {
        const p = await preparar({ sociedad: true });
        const titular = cuitConPrefijo("20");
        const { entrada, salida } = await p.pedir({ cuitTitular: titular });
        const intacto = async () => {
          expect(await certificado(entrada.id)).toMatchObject({
            estado: "PEDIDO_GENERADO",
            huella: null,
            pem: null,
            vence: null,
            version: 1,
          });
          expect(await auditorias(p.e.empresa, entrada.id)).toHaveLength(1);
          expect(await vigentes(p.e)).toBe(0);
        };

        // 1. El certificado lleva el CUIT de la SOCIEDAD (la empresa representada), no el del titular declarado.
        expect(
          await p.cargar(
            entrada.id,
            await certificadoValido(salida, { numeroDeSerie: SERIE_DE(p.e.cuit) }),
          ),
        ).toEqual({ ok: false, error: "NO_CORRESPONDE_AL_TITULAR" });
        // 2. Lleva el CUIT de otra persona física.
        expect(
          await p.cargar(
            entrada.id,
            await certificadoValido(salida, { numeroDeSerie: SERIE_DE(cuitConPrefijo("27")) }),
          ),
        ).toEqual({ ok: false, error: "NO_CORRESPONDE_AL_TITULAR" });
        await intacto();
        // 3. Vencido.
        expect(
          await p.cargar(
            entrada.id,
            await certificadoValido(salida, {
              noAntes: new Date(Date.now() - 800 * DIA),
              noDespues: new Date(Date.now() - DIA),
            }),
          ),
        ).toEqual({ ok: false, error: "CERTIFICADO_VENCIDO" });
        // 4. De la cadena del otro ambiente.
        expect(
          await p.cargar(entrada.id, await certificadoValido(salida, {}, "PRODUCCION")),
        ).toEqual({ ok: false, error: "CADENA_NO_CONFIABLE" });
        // 5. De otra clave (el de otro pedido del mismo titular y el mismo alias).
        const otro = await p.pedir({ cuitTitular: titular, alias: entrada.alias });
        expect(await p.cargar(entrada.id, await certificadoValido(otro.salida))).toEqual({
          ok: false,
          error: "NO_CORRESPONDE_A_LA_CLAVE",
        });
        await intacto();
        // Y el certificado bueno, ahora sí.
        expect((await p.cargar(entrada.id, await certificadoValido(salida))).ok).toBe(true);
      });

      it("con varios defectos manda el error del orden documentado (§B.6.2): clave, titular, cadena, vencimiento", async () => {
        const p = await preparar({ sociedad: true });
        const titular = cuitConPrefijo("20");
        const a = await p.pedir({ cuitTitular: titular });
        const b = await p.pedir({ cuitTitular: titular });
        const todoMal = {
          numeroDeSerie: SERIE_DE(p.e.cuit),
          noAntes: new Date(Date.now() - 800 * DIA),
          noDespues: new Date(Date.now() - DIA),
        };
        // De la cadena ajena, con otro serialNumber y vencido, y además de OTRA clave: manda la clave.
        const deB = await certificadoValido(b.salida, todoMal, "PRODUCCION");
        expect(await p.cargar(a.entrada.id, deB)).toEqual({
          ok: false,
          error: "NO_CORRESPONDE_A_LA_CLAVE",
        });
        // De la clave: manda el titular.
        const deA = await certificadoValido(a.salida, todoMal, "PRODUCCION");
        expect(await p.cargar(a.entrada.id, deA)).toEqual({
          ok: false,
          error: "NO_CORRESPONDE_AL_TITULAR",
        });
        // Con el titular bien: manda la cadena.
        const conTitular = { ...todoMal, numeroDeSerie: SERIE_DE(titular) };
        expect(
          await p.cargar(a.entrada.id, await certificadoValido(a.salida, conTitular, "PRODUCCION")),
        ).toEqual({ ok: false, error: "CADENA_NO_CONFIABLE" });
        // Con la cadena bien: el vencimiento.
        expect(await p.cargar(a.entrada.id, await certificadoValido(a.salida, conTitular))).toEqual(
          {
            ok: false,
            error: "CERTIFICADO_VENCIDO",
          },
        );
      });

      it("aislamiento: el mismo titular en dos empresas no mezcla nada; cada certificado carga solo en el pedido de su empresa", async () => {
        const titular = cuitConPrefijo("20");
        const a = await preparar({ sociedad: true });
        const b = await preparar({ sociedad: true });
        const pa = await a.pedir({ cuitTitular: titular, alias: "mismoalias" });
        const pb = await b.pedir({ cuitTitular: titular, alias: "mismoalias" });
        const deA = await certificadoValido(pa.salida);
        const deB = await certificadoValido(pb.salida);
        // Aunque el titular, el alias y el ambiente sean iguales, la clave de cada pedido es la suya.
        expect(await b.cargar(pb.entrada.id, deA)).toEqual({
          ok: false,
          error: "NO_CORRESPONDE_A_LA_CLAVE",
        });
        // Y el pedido de otra empresa no existe para esta.
        expect(await b.cargar(pa.entrada.id, deA)).toEqual({
          ok: false,
          error: "CERTIFICADO_NO_ENCONTRADO",
        });
        expect((await a.cargar(pa.entrada.id, deA)).ok).toBe(true);
        expect((await b.cargar(pb.entrada.id, deB)).ok).toBe(true);
        expect(await vigentes(a.e)).toBe(1);
        expect(await vigentes(b.e)).toBe(1);
        expect(await auditorias(a.e.empresa, pb.entrada.id)).toHaveLength(0);
      });

      it("un administrador no puede declarar un titular ni cargar su certificado (SIN_PERMISO)", async () => {
        const p = await preparar({ rol: "ADMINISTRADOR" });
        const r = await casos.generarPedidoDeCertificado(
          p.como(),
          pedidoDeCertificado(p.e, { cuitTitular: cuitConPrefijo("20") }),
        );
        expect(r).toEqual({ ok: false, error: "SIN_PERMISO" });
      });
    });

    it("un administrador no puede cargar (SIN_PERMISO) y no cambia nada", async () => {
      const p = await preparar();
      const { entrada, salida } = await p.pedir();
      const admin =
        (
          await dueno.query<{ id: string }>(
            "insert into persona (email) values ($1) returning id",
            [`${randomUUID().slice(0, 12)}@prueba.test`],
          )
        ).rows[0]?.id ?? "";
      await crearMembresiaDeBase(dueno, p.e.empresa, admin, "ADMINISTRADOR");
      const r = await casos.cargarCertificado(
        { ...p.e.como(new Date()), personaId: admin as never },
        {
          certificadoId: certificadoId(entrada.id),
          certificadoPem: await certificadoValido(salida),
        },
      );
      expect(r).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect((await certificado(entrada.id))?.estado).toBe("PEDIDO_GENERADO");
    });
  });
});

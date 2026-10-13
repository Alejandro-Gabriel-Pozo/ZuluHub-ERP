import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { acepta, check, clave, conAppDe, denegado, referencia, sinConfirmar } from "./fiscal-apoyo";
import {
  crearComprobante,
  crearEscenario,
  datosDeComprobante,
  entrarEnValidacion,
  huellaAlAzar,
  insertarComprobante,
  marcarAutorizado,
  viaDueno,
  type Escenario,
} from "./facturacion-apoyo";

/**
 * Facturación F2: los certificados de ARCA, el ticket de acceso cacheado y los intentos contra ARCA (§B.8.5),
 * y que nada de lo facturado se borra. Los privilegios de columna exactos están en `catalogo.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const huellaDe = (texto: string): string => createHash("sha256").update(texto).digest("hex");

type Estado = "PEDIDO_GENERADO" | "VIGENTE" | "REEMPLAZADO" | "DESCARTADO";
const ESTADOS: readonly Estado[] = ["PEDIDO_GENERADO", "VIGENTE", "REEMPLAZADO", "DESCARTADO"];
/** El ciclo de §G.3: cargar, reemplazar y descartar. */
const TRANSICIONES: Readonly<Record<Estado, readonly Estado[]>> = {
  PEDIDO_GENERADO: ["VIGENTE", "DESCARTADO"],
  VIGENTE: ["REEMPLAZADO"],
  REEMPLAZADO: [],
  DESCARTADO: [],
};

describe.skipIf(base === null)("facturación: certificados, ticket de acceso e intentos", () => {
  let dueno: pg.Client;
  let e: Escenario;

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
    e = await crearEscenario(dueno);
  });
  afterAll(async () => {
    await dueno.end();
  });

  const intento = viaDueno;
  const deshacible = <T>(trabajo: () => Promise<T>) => sinConfirmar(dueno, trabajo);

  // ---- certificados ----------------------------------------------------------------------------

  /** Las columnas que la aplicación manda al pedir un certificado. */
  const pedido = (
    x: Escenario,
    cambios: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id: randomUUID(),
    empresa_id: x.empresa,
    emisor_id: x.emisor,
    ambiente: "HOMOLOGACION",
    alias: "zuluhub1",
    cuit_titular: x.cuit,
    pedido_pem: "-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----",
    clave_cifrada: Buffer.alloc(64, 7),
    clave_nonce: Buffer.alloc(12, 1),
    clave_etiqueta: Buffer.alloc(16, 2),
    clave_kid: "k1",
    creado_por: x.persona,
    ...cambios,
  });
  const insertarCertificado = (ej: ReturnType<typeof viaDueno>, datos: Record<string, unknown>) => {
    const columnas = Object.keys(datos);
    return ej(
      `insert into certificado_arca (${columnas.join(", ")}) values (${columnas.map((_, i) => `$${i + 1}`).join(", ")})`,
      columnas.map((c) => datos[c]),
    );
  };
  const cargar = (id: string, huella = huellaAlAzar()) => ({
    texto: `update certificado_arca set estado = 'VIGENTE', certificado_pem = $2, huella_sha256 = $3,
            vence_en = now() + interval '1 year' where id = $1`,
    parametros: [id, PEM, huella],
  });

  describe("certificado_arca", () => {
    it("la aplicación pide un certificado (nace como pedido generado) y lo carga; el pedido y la clave quedan fijos", async () => {
      const x = await crearEscenario(dueno);
      const datos = pedido(x);
      await conAppDe(base!, x, async (s) => {
        const columnas = Object.keys(datos);
        acepta(
          await s.intentar(
            `insert into certificado_arca (${columnas.join(", ")}) values (${columnas.map((_, i) => `$${i + 1}`).join(", ")})`,
            columnas.map((c) => datos[c]),
          ),
        );
        const c = cargar(datos["id"] as string);
        acepta(await s.intentar(c.texto, c.parametros));
        acepta(await s.confirmar());
      });
      const { rows } = await dueno.query(
        "select estado, version, vence_en > now() as vigente from certificado_arca where id = $1",
        [datos["id"]],
      );
      expect(rows[0]).toEqual({ estado: "VIGENTE", version: 2, vigente: true });
    });

    it("la aplicación no elige el estado al pedirlo, ni a nombre de otra persona, y no toca la clave después (42501)", async () => {
      const x = await crearEscenario(dueno);
      await conAppDe(base!, x, async (s) => {
        const columnas = (d: Record<string, unknown>) => Object.keys(d);
        for (const cambios of [
          { estado: "VIGENTE" },
          { huella_sha256: huellaAlAzar() },
          { certificado_pem: PEM },
        ]) {
          const d = pedido(x, cambios);
          denegado(
            await s.intentar(
              `insert into certificado_arca (${columnas(d).join(", ")}) values (${columnas(d)
                .map((_, i) => `$${i + 1}`)
                .join(", ")})`,
              columnas(d).map((c) => d[c]),
            ),
          );
        }
        // A nombre de otra persona: la política exige la persona del contexto.
        const ajeno = pedido(x, { creado_por: e.persona });
        denegado(
          await s.intentar(
            `insert into certificado_arca (${columnas(ajeno).join(", ")}) values (${columnas(ajeno)
              .map((_, i) => `$${i + 1}`)
              .join(", ")})`,
            columnas(ajeno).map((c) => ajeno[c]),
          ),
        );
      });
      const id = randomUUID();
      await dueno.query(
        `insert into certificado_arca (id, empresa_id, emisor_id, ambiente, alias, cuit_titular, pedido_pem, clave_cifrada, clave_nonce, clave_etiqueta, clave_kid, creado_por)
         values ($1, $2, $3, 'HOMOLOGACION', 'abc', $4, 'P', $5, $6, $7, 'k', $8)`,
        [
          id,
          x.empresa,
          x.emisor,
          x.cuit,
          Buffer.alloc(8),
          Buffer.alloc(12),
          Buffer.alloc(16),
          x.persona,
        ],
      );
      await conAppDe(base!, x, async (s) => {
        for (const col of [
          "clave_cifrada",
          "clave_nonce",
          "clave_etiqueta",
          "clave_kid",
          "pedido_pem",
          "alias",
          "cuit_titular",
          "ambiente",
          "emisor_id",
          "creado_por",
        ]) {
          denegado(
            await s.intentar(`update certificado_arca set ${col} = ${col} where id = $1`, [id]),
          );
        }
        denegado(await s.intentar("delete from certificado_arca where id = $1", [id]));
      });
    });

    it.each<[string, Record<string, unknown>, string]>([
      ["un ambiente que no existe", { ambiente: "PRUEBAS" }, "certificado_ambiente_ck"],
      ["un alias con espacios", { alias: "mi cert" }, "certificado_alias_ck"],
      ["un alias de 31 caracteres", { alias: "a".repeat(31) }, "certificado_alias_ck"],
      ["un alias vacío", { alias: "" }, "certificado_alias_ck"],
      [
        "un CUIT del titular inválido",
        { cuit_titular: "20123456787" },
        "certificado_cuit_titular_ck",
      ],
      ["un nonce de 11 bytes", { clave_nonce: Buffer.alloc(11) }, "certificado_cifrado_ck"],
      ["una etiqueta de 15 bytes", { clave_etiqueta: Buffer.alloc(15) }, "certificado_cifrado_ck"],
      ["una clave cifrada vacía", { clave_cifrada: Buffer.alloc(0) }, "certificado_clave_ck"],
      [
        "una clave cifrada de 8193 bytes",
        { clave_cifrada: Buffer.alloc(8193) },
        "certificado_clave_ck",
      ],
      ["un pedido vacío", { pedido_pem: "" }, "certificado_pedido_ck"],
      ["un identificador de clave en blanco", { clave_kid: " " }, "certificado_kid_ck"],
    ])("un pedido con %s se rechaza", async (_n, cambios, restriccion) => {
      await deshacible(async () => {
        check(await insertarCertificado(intento(dueno), pedido(e, cambios)), restriccion);
      });
    });

    it("nace como pedido generado: ni el dueño lo crea ya vigente", async () => {
      await deshacible(async () => {
        check(
          await insertarCertificado(intento(dueno), {
            ...pedido(e),
            estado: "VIGENTE",
            certificado_pem: PEM,
            huella_sha256: huellaAlAzar(),
            vence_en: "2030-01-01T00:00:00Z",
          }),
          "certificado_transicion_invalida",
        );
      });
    });

    it("el emisor es de la misma empresa (clave foránea compuesta)", async () => {
      const otra = await crearEscenario(dueno);
      await deshacible(async () => {
        referencia(
          await insertarCertificado(intento(dueno), pedido(e, { emisor_id: otra.emisor })),
          "certificado_emisor_fkey",
        );
      });
    });

    it("la base permite exactamente el ciclo PEDIDO_GENERADO → VIGENTE → REEMPLAZADO (y PEDIDO_GENERADO → DESCARTADO): los 12 pares", async () => {
      const aceptadas = new Set<string>();
      for (const de of ESTADOS) {
        await deshacible(async () => {
          const id = randomUUID();
          acepta(await insertarCertificado(intento(dueno), pedido(e, { id })));
          if (de === "VIGENTE" || de === "REEMPLAZADO") {
            const c = cargar(id);
            acepta(await intento(dueno)(c.texto, c.parametros));
          }
          if (de === "REEMPLAZADO") {
            acepta(
              await intento(dueno)(
                "update certificado_arca set estado = 'REEMPLAZADO' where id = $1",
                [id],
              ),
            );
          }
          if (de === "DESCARTADO") {
            acepta(
              await intento(dueno)(
                "update certificado_arca set estado = 'DESCARTADO' where id = $1",
                [id],
              ),
            );
          }
          for (const a of ESTADOS) {
            if (a === de) continue;
            await dueno.query("savepoint candidato");
            const c =
              a === "VIGENTE"
                ? cargar(id)
                : {
                    texto: "update certificado_arca set estado = $2 where id = $1",
                    parametros: [id, a],
                  };
            const r = await intento(dueno)(c.texto, c.parametros);
            expect(r.ok, `${de} → ${a}`).toBe(TRANSICIONES[de].includes(a));
            if (!r.ok) {
              expect(r.codigo, `${de} → ${a}: ${r.mensaje}`).toBe("23514");
              expect(r.restriccion, `${de} → ${a}`).toBe("certificado_transicion_invalida");
            } else {
              aceptadas.add(`${de}→${a}`);
            }
            await dueno.query("rollback to savepoint candidato");
          }
        });
      }
      expect([...aceptadas].sort()).toEqual([
        "PEDIDO_GENERADO→DESCARTADO",
        "PEDIDO_GENERADO→VIGENTE",
        "VIGENTE→REEMPLAZADO",
      ]);
    });

    it("lo que no se carga bien no pasa: VIGENTE sin certificado, sin huella o sin vencimiento; el pedido descartado con certificado", async () => {
      for (const set of [
        "estado = 'VIGENTE', huella_sha256 = $2, vence_en = now()",
        "estado = 'VIGENTE', certificado_pem = 'P', vence_en = now()",
        "estado = 'VIGENTE', certificado_pem = 'P', huella_sha256 = $2",
        "estado = 'VIGENTE', certificado_pem = 'P', huella_sha256 = 'no-es-sha256', vence_en = now()",
        "estado = 'DESCARTADO', certificado_pem = 'P'",
        "autorizacion_verificada_en = now()",
      ]) {
        await deshacible(async () => {
          const id = randomUUID();
          acepta(await insertarCertificado(intento(dueno), pedido(e, { id })));
          const parametros = set.includes("$2") ? [id, huellaAlAzar()] : [id];
          const r = await intento(dueno)(
            `update certificado_arca set ${set} where id = $1`,
            parametros,
          );
          expect(r.ok, set).toBe(false);
          if (!r.ok)
            expect(["certificado_cargado_ck", "certificado_huella_ck"], set).toContain(
              r.restriccion,
            );
        });
      }
    });

    it("el pedido, la clave y la identidad no cambian nunca; el certificado cargado y su huella tampoco; la verificación se anota una sola vez", async () => {
      await deshacible(async () => {
        const id = randomUUID();
        acepta(await insertarCertificado(intento(dueno), pedido(e, { id })));
        for (const set of [
          "alias = 'otro'",
          "pedido_pem = 'otro'",
          "clave_cifrada = '\\x00'::bytea",
          "clave_nonce = '\\x000000000000000000000000'::bytea",
          "clave_kid = 'k2'",
          "ambiente = 'PRODUCCION'",
          "cuit_titular = '30500010912'",
          "creado_en = now() - interval '1 day'",
          "id = gen_random_uuid()",
        ]) {
          check(
            await intento(dueno)(`update certificado_arca set ${set} where id = $1`, [id]),
            "certificado_inmutable",
          );
        }
        const c = cargar(id);
        acepta(await intento(dueno)(c.texto, c.parametros));
        // Cargado, el certificado no se pisa (se carga otro).
        for (const set of [
          "certificado_pem = 'otro'",
          `huella_sha256 = '${huellaAlAzar()}'`,
          "vence_en = vence_en + interval '1 day'",
        ]) {
          check(
            await intento(dueno)(`update certificado_arca set ${set} where id = $1`, [id]),
            "certificado_inmutable",
          );
        }
        // La primera llamada exitosa se anota; no se cambia ni se borra.
        acepta(
          await intento(dueno)(
            "update certificado_arca set autorizacion_verificada_en = now() where id = $1",
            [id],
          ),
        );
        check(
          await intento(dueno)(
            "update certificado_arca set autorizacion_verificada_en = now() + interval '1 hour' where id = $1",
            [id],
          ),
          "certificado_inmutable",
        );
        check(
          await intento(dueno)(
            "update certificado_arca set autorizacion_verificada_en = null where id = $1",
            [id],
          ),
          "certificado_inmutable",
        );
      });
    });

    it("a lo sumo un certificado VIGENTE por emisor y ambiente; reemplazar es dejar el viejo REEMPLAZADO y cargar el nuevo, en una transacción", async () => {
      const x = await crearEscenario(dueno);
      await deshacible(async () => {
        const uno = randomUUID();
        const dos = randomUUID();
        const otroAmbiente = randomUUID();
        for (const id of [uno, dos])
          acepta(await insertarCertificado(intento(dueno), pedido(x, { id })));
        acepta(
          await insertarCertificado(
            intento(dueno),
            pedido(x, { id: otroAmbiente, ambiente: "PRODUCCION" }),
          ),
        );
        for (const [id, h] of [
          [uno, huellaDe("uno")],
          [otroAmbiente, huellaDe("prod")],
        ] as const) {
          const c = cargar(id, h);
          acepta(await intento(dueno)(c.texto, c.parametros));
        }
        // Otro VIGENTE en el mismo ambiente: no.
        const choque = cargar(dos, huellaDe("dos"));
        clave(await intento(dueno)(choque.texto, choque.parametros), "certificado_vigente_uk");
        // Reemplazo: primero el viejo, después el nuevo.
        acepta(
          await intento(dueno)("update certificado_arca set estado = 'REEMPLAZADO' where id = $1", [
            uno,
          ]),
        );
        acepta(await intento(dueno)(choque.texto, choque.parametros));
      });
    });

    it("el mismo certificado (misma huella) no se carga dos veces en la empresa, pero otra empresa puede tener el suyo", async () => {
      const x = await crearEscenario(dueno);
      const otra = await crearEscenario(dueno);
      const huella = huellaDe(randomUUID());
      await deshacible(async () => {
        const uno = randomUUID();
        const dos = randomUUID();
        const ajeno = randomUUID();
        acepta(await insertarCertificado(intento(dueno), pedido(x, { id: uno })));
        acepta(
          await insertarCertificado(intento(dueno), pedido(x, { id: dos, ambiente: "PRODUCCION" })),
        );
        acepta(await insertarCertificado(intento(dueno), pedido(otra, { id: ajeno })));
        for (const [id, esperado] of [
          [uno, true],
          [dos, false],
          [ajeno, true],
        ] as const) {
          const c = cargar(id, huella);
          const r = await intento(dueno)(c.texto, c.parametros);
          expect(r.ok, id).toBe(esperado);
          if (!r.ok) expect(r.restriccion).toBe("certificado_huella_uk");
        }
      });
    });
  });

  // ---- ticket de acceso ------------------------------------------------------------------------

  describe("acceso_arca", () => {
    const conCertificado = async <T>(trabajo: (certificado: string) => Promise<T>) =>
      deshacible(async () => {
        const id = randomUUID();
        acepta(await insertarCertificado(intento(dueno), pedido(e, { id })));
        return trabajo(id);
      });
    const credencial = (cambios: Record<string, unknown> = {}) => ({
      cifrada: Buffer.alloc(900, 9),
      nonce: Buffer.alloc(12, 3),
      etiqueta: Buffer.alloc(16, 4),
      kid: "k1",
      generado: "2026-10-13T10:00:00Z",
      expira: "2026-10-13T22:00:00Z",
      ...cambios,
    });
    const guardarCredencial = (certificado: string, c: ReturnType<typeof credencial>) =>
      intento(dueno)(
        `update acceso_arca set credencial_cifrada = $3, credencial_nonce = $4, credencial_etiqueta = $5, credencial_kid = $6,
                generado_en = $7, expira_en = $8, renovando_hasta = null where empresa_id = $1 and certificado_id = $2`,
        [e.empresa, certificado, c.cifrada, c.nonce, c.etiqueta, c.kid, c.generado, c.expira],
      );

    it("la fila nace vacía, recibe el ticket cifrado completo y se renueva; es una por certificado y servicio", async () => {
      await conCertificado(async (certificado) => {
        acepta(
          await intento(dueno)(
            "insert into acceso_arca (empresa_id, certificado_id, servicio) values ($1, $2, 'wsfe')",
            [e.empresa, certificado],
          ),
        );
        acepta(await guardarCredencial(certificado, credencial()));
        acepta(
          await guardarCredencial(
            certificado,
            credencial({ generado: "2026-10-14T10:00:00Z", expira: "2026-10-14T22:00:00Z" }),
          ),
        );
        clave(
          await intento(dueno)(
            "insert into acceso_arca (empresa_id, certificado_id, servicio) values ($1, $2, 'wsfe')",
            [e.empresa, certificado],
          ),
          "acceso_pkey",
        );
        // Vaciar el ticket (una renovación que falló) también es válido.
        acepta(
          await intento(dueno)(
            `update acceso_arca set credencial_cifrada = null, credencial_nonce = null, credencial_etiqueta = null,
                    credencial_kid = null, generado_en = null, expira_en = null where certificado_id = $1`,
            [certificado],
          ),
        );
      });
    });

    it.each<[string, Record<string, unknown>]>([
      ["un vencimiento anterior a la generación", { expira: "2026-10-13T09:00:00Z" }],
      ["un vencimiento igual a la generación", { expira: "2026-10-13T10:00:00Z" }],
      ["un nonce de 11 bytes", { nonce: Buffer.alloc(11) }],
      ["una etiqueta de 17 bytes", { etiqueta: Buffer.alloc(17) }],
      ["un ticket vacío", { cifrada: Buffer.alloc(0) }],
      ["un ticket gigante", { cifrada: Buffer.alloc(8193) }],
      ["un identificador de clave en blanco", { kid: "  " }],
    ])("un ticket con %s se rechaza (acceso_completo_ck)", async (_n, cambios) => {
      await conCertificado(async (certificado) => {
        acepta(
          await intento(dueno)(
            "insert into acceso_arca (empresa_id, certificado_id, servicio) values ($1, $2, 'wsfe')",
            [e.empresa, certificado],
          ),
        );
        check(await guardarCredencial(certificado, credencial(cambios)), "acceso_completo_ck");
      });
    });

    it("un ticket a medias (con credencial pero sin vencimiento, o al revés) se rechaza", async () => {
      await conCertificado(async (certificado) => {
        acepta(
          await intento(dueno)(
            "insert into acceso_arca (empresa_id, certificado_id, servicio) values ($1, $2, 'wsfe')",
            [e.empresa, certificado],
          ),
        );
        check(
          await intento(dueno)(
            "update acceso_arca set credencial_cifrada = $2 where certificado_id = $1",
            [certificado, Buffer.alloc(10)],
          ),
          "acceso_completo_ck",
        );
        check(
          await intento(dueno)(
            "update acceso_arca set expira_en = now(), generado_en = now() - interval '1 hour' where certificado_id = $1",
            [certificado],
          ),
          "acceso_completo_ck",
        );
      });
    });

    it("el servicio es uno solo (wsfe), y el certificado es de la misma empresa", async () => {
      const otra = await crearEscenario(dueno);
      await conCertificado(async (certificado) => {
        check(
          await intento(dueno)(
            "insert into acceso_arca (empresa_id, certificado_id, servicio) values ($1, $2, 'wsfex')",
            [e.empresa, certificado],
          ),
          "acceso_servicio_ck",
        );
        referencia(
          await intento(dueno)(
            "insert into acceso_arca (empresa_id, certificado_id, servicio) values ($1, $2, 'wsfe')",
            [otra.empresa, certificado],
          ),
          "acceso_certificado_fkey",
        );
      });
    });
  });

  // ---- intentos --------------------------------------------------------------------------------

  describe("intento_arca", () => {
    const intentoDe = (
      comprobante: string,
      cambios: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      id: randomUUID(),
      empresa_id: e.empresa,
      comprobante_id: comprobante,
      operacion: "AUTORIZAR",
      numero: "1",
      desenlace: "AUTORIZADO",
      mensajes: "[]",
      respuesta: "<xml/>",
      huella_pedido: huellaAlAzar(),
      iniciado_en: "2026-10-13T10:00:00Z",
      duracion_ms: 120,
      ...cambios,
    });
    const insertarIntento = (ej: ReturnType<typeof viaDueno>, d: Record<string, unknown>) => {
      const columnas = Object.keys(d);
      return ej(
        `insert into intento_arca (${columnas.join(", ")}) values (${columnas.map((_, i) => `$${i + 1}`).join(", ")})`,
        columnas.map((c) => d[c]),
      );
    };

    it("guarda cada llamada a ARCA con su desenlace, códigos y respuesta; es de solo inserción, aun para el dueño (42501)", async () => {
      const comprobante = await crearComprobante(dueno, e);
      await deshacible(async () => {
        const d = intentoDe(comprobante, {
          mensajes: JSON.stringify([
            { codigo: 10016, texto: "fuera de secuencia", clase: "ERROR" },
          ]),
          desenlace: "RECHAZADO",
        });
        acepta(await insertarIntento(intento(dueno), d));
        denegado(
          await intento(dueno)("update intento_arca set duracion_ms = 1 where id = $1", [d["id"]]),
        );
        denegado(await intento(dueno)("delete from intento_arca where id = $1", [d["id"]]));
        denegado(await intento(dueno)("truncate intento_arca"));
      });
    });

    it("cada operación termina de una de sus maneras: los 24 pares de operación y desenlace, 9 válidos", async () => {
      const comprobante = await crearComprobante(dueno, e);
      const operaciones = ["AUTORIZAR", "CONSULTAR", "ULTIMO_AUTORIZADO"];
      const desenlaces = [
        "AUTORIZADO",
        "RECHAZADO",
        "INCIERTO",
        "NO_ENVIADO",
        "ENCONTRADO",
        "NO_ENCONTRADO",
        "CONSULTA_FALLIDA",
        "RESPONDIDO",
      ];
      const validos = new Set([
        "AUTORIZAR/AUTORIZADO",
        "AUTORIZAR/RECHAZADO",
        "AUTORIZAR/INCIERTO",
        "AUTORIZAR/NO_ENVIADO",
        "CONSULTAR/ENCONTRADO",
        "CONSULTAR/NO_ENCONTRADO",
        "CONSULTAR/CONSULTA_FALLIDA",
        "ULTIMO_AUTORIZADO/RESPONDIDO",
        "ULTIMO_AUTORIZADO/CONSULTA_FALLIDA",
      ]);
      let aceptados = 0;
      await deshacible(async () => {
        for (const operacion of operaciones) {
          for (const desenlace of desenlaces) {
            const r = await insertarIntento(
              intento(dueno),
              intentoDe(comprobante, { operacion, desenlace }),
            );
            expect(r.ok, `${operacion}/${desenlace}`).toBe(
              validos.has(`${operacion}/${desenlace}`),
            );
            if (!r.ok) expect(r.restriccion).toBe("intento_operacion_desenlace_ck");
            else aceptados += 1;
          }
        }
      });
      expect(aceptados).toBe(9);
    });

    it.each<[string, Record<string, unknown>, string]>([
      ["una operación que no existe", { operacion: "ANULAR" }, "intento_operacion_ck"],
      ["un desenlace que no existe", { desenlace: "PERDIDO" }, "intento_desenlace_ck"],
      ["mensajes que no son una lista", { mensajes: '{"codigo": 1}' }, "intento_mensajes_ck"],
      ["una respuesta de más de 64 KB", { respuesta: "x".repeat(65537) }, "intento_respuesta_ck"],
      ["una huella de pedido que no es SHA-256", { huella_pedido: "abc" }, "intento_huella_ck"],
      ["una duración negativa", { duracion_ms: -1 }, "intento_duracion_ck"],
      ["un número negativo", { numero: "-1" }, "intento_numero_ck"],
    ])("un intento con %s se rechaza", async (_n, cambios, restriccion) => {
      const comprobante = await crearComprobante(dueno, e);
      await deshacible(async () => {
        check(await insertarIntento(intento(dueno), intentoDe(comprobante, cambios)), restriccion);
      });
    });

    it("un intento es de un comprobante de la misma empresa (clave foránea compuesta)", async () => {
      const otra = await crearEscenario(dueno);
      const ajeno = await crearComprobante(dueno, otra);
      await deshacible(async () => {
        referencia(
          await insertarIntento(intento(dueno), intentoDe(ajeno)),
          "intento_comprobante_fkey",
        );
      });
    });

    it("la aplicación guarda sus intentos con su rol (también el trabajo de sistema, sin persona) y los lee", async () => {
      const comprobante = await crearComprobante(dueno, e);
      for (const persona of [e.persona, null]) {
        await conAppDe(
          base!,
          e,
          async (s) => {
            const d = intentoDe(comprobante);
            const columnas = Object.keys(d);
            acepta(
              await s.intentar(
                `insert into intento_arca (${columnas.join(", ")}) values (${columnas.map((_, i) => `$${i + 1}`).join(", ")})`,
                columnas.map((c) => d[c]),
              ),
            );
            const r = await s.intentar(
              "select count(*)::int as n from intento_arca where comprobante_id = $1",
              [comprobante],
            );
            expect(r.ok && Number(r.rows[0]?.["n"])).toBeGreaterThan(0);
            denegado(
              await s.intentar("update intento_arca set duracion_ms = 0 where id = $1", [d["id"]]),
            );
            denegado(await s.intentar("delete from intento_arca where id = $1", [d["id"]]));
          },
          persona,
        );
      }
    });
  });

  // ---- nada se borra ---------------------------------------------------------------------------

  describe("nada de lo facturado se borra ni se vacía, ni siquiera el dueño de la base", () => {
    it("comprobante, certificado y ticket de acceso: ni DELETE ni TRUNCATE (42501)", async () => {
      const comprobante = await crearComprobante(dueno, e);
      await deshacible(async () => {
        denegado(await intento(dueno)("delete from comprobante where id = $1", [comprobante]));
        // Vaciar una tabla a la que apuntan otras exige nombrarlas todas: el disparador frena el vaciado igual.
        denegado(
          await intento(dueno)(
            "truncate comprobante, comprobante_linea, comprobante_alicuota, intento_arca",
          ),
        );
        const id = randomUUID();
        acepta(await insertarCertificado(intento(dueno), pedido(e, { id })));
        denegado(await intento(dueno)("delete from certificado_arca where id = $1", [id]));
        denegado(await intento(dueno)("truncate certificado_arca, acceso_arca"));
        acepta(
          await intento(dueno)(
            "insert into acceso_arca (empresa_id, certificado_id, servicio) values ($1, $2, 'wsfe')",
            [e.empresa, id],
          ),
        );
        denegado(await intento(dueno)("delete from acceso_arca where certificado_id = $1", [id]));
        denegado(await intento(dueno)("truncate acceso_arca"));
      });
      expect(
        (await dueno.query("select 1 from comprobante where id = $1", [comprobante])).rowCount,
      ).toBe(1);
    });

    it("un comprobante se anula con un registro nuevo (nota de crédito), nunca desapareciendo: el original sigue y la nota lo cita", async () => {
      const x = await crearEscenario(dueno);
      await deshacible(async () => {
        const original = datosDeComprobante(x);
        acepta(await insertarComprobante(intento(dueno), original));
        acepta(await entrarEnValidacion(intento(dueno), original["id"] as string, "1"));
        acepta(await marcarAutorizado(intento(dueno), original["id"] as string));
        const nota = datosDeComprobante(x, {
          clase: "NOTA_CREDITO",
          tipo_comprobante: "NOTA_CREDITO_B",
          comprobante_asociado_id: original["id"],
          motivo: "anulación de la factura",
        });
        acepta(await insertarComprobante(intento(dueno), nota));
        const { rows } = await dueno.query(
          `select o.estado as original, n.estado as nota, n.comprobante_asociado_id = o.id as cita
             from comprobante o join comprobante n on n.comprobante_asociado_id = o.id where o.id = $1`,
          [original["id"]],
        );
        expect(rows[0]).toEqual({ original: "AUTORIZADO", nota: "PENDIENTE", cita: true });
      });
    });
  });
});

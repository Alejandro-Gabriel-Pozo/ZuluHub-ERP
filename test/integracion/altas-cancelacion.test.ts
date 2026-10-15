import pg from "pg";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import type { ContextoDePlataforma } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeIdentidad,
  crearManejadorDeEnviarInvitacion,
} from "../../src/modulos/identidad/publico";
import {
  crearCasosDeUsoDeAltas,
  type CasosDeUsoDeAltas,
} from "../../src/plataforma/casos-de-uso/altas";
import {
  empresaId,
  invitacionId,
  marcaComercialId,
} from "../../src/primitivas/identificadores/marca";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import type { TrabajoTomado } from "../../src/puertos/cola-de-trabajos";
import type { Correo, MensajeDeCorreo } from "../../src/puertos/correo";
import type { Tokens } from "../../src/puertos/tokens";
import { MODULOS_DE_PRUEBA } from "../utilidades/planes";
import { usuarioDePrueba } from "../utilidades/usuarios";
import { ADMIN_DE_PRUEBA } from "./admins-de-prueba";
import {
  altaNueva,
  comoAdminAhora,
  comoSoporteAhora,
  crearCasosDeAlta,
  crearEntornoDeAlta,
  crearMarcaLista,
  crearTenantConPlan,
  tokensDePrueba,
  type TxDeAltaDePrueba,
} from "./altas-apoyo";
import { crearBarrera, crearBaseAparte, crearEntornoDePrueba, cuitAlAzar } from "./entorno";
import { crearInvitacionDeBase, emailAlAzar, incluirEmpresa } from "./fixtures-identidad";
import { claveAlAzar } from "./plataforma-apoyo";
import { plataformaEn } from "./soporte-datos";

/**
 * Cancelar el alta y el barrido de altas vencidas (H5 P5, §B.5.3) contra Postgres real: lo que cambia, lo
 * que revoca, lo que audita, el plazo de 72 horas al milisegundo, que sea repetible y que una falla no frene
 * al resto. Las carreras (aceptar contra cancelar, cancelar contra el barrido) y el mail que ya no sale.
 * Base propia.
 */

const base = inject("baseDePruebas");
const HORA = 3_600_000;

/** Una carrera arma solo el lado que se pide: el otro es `null`, y pedirlo es un error de la prueba. */
function falsoSiNoHay(): never {
  throw new Error("la carrera no armó ese lado");
}

function exito<T>(r: Resultado<T, unknown>): T {
  if (!r.ok) throw new Error(`tenía que salir bien: ${JSON.stringify(r.error)}`);
  return r.valor;
}
const falla = <T>(r: Resultado<T, unknown>) => {
  if (r.ok) throw new Error("tenía que fallar");
  return r.error;
};

describe.skipIf(base === null)("cancelar el alta y el barrido de altas vencidas", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeAltaDePrueba>;
  let entornoGeneral: ReturnType<typeof crearEntornoDePrueba>;
  let tokens: Tokens;
  let casos: CasosDeUsoDeAltas;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeAlta(propia.base, 6);
    entornoGeneral = crearEntornoDePrueba(propia.base, 4);
    tokens = tokensDePrueba();
    casos = crearCasosDeAlta(entorno, tokens);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoGeneral.cerrar();
    await propia.destruir();
  });

  const una = <T extends Record<string, unknown>>(texto: string, parametros: unknown[] = []) =>
    dueno.query<T>(texto, parametros).then((r) => r.rows[0] as T);
  const todas = <T extends Record<string, unknown>>(texto: string, parametros: unknown[] = []) =>
    dueno.query<T>(texto, parametros).then((r) => r.rows);
  const cuenta = async (texto: string, parametros: unknown[] = []) =>
    Number(((await dueno.query(texto, parametros)).rows[0] as { n: string }).n);

  /** Un alta recién hecha por el caso de uso real, en una marca lista. */
  async function unaAlta() {
    const m = await crearMarcaLista(dueno);
    const entrada = altaNueva(m.marca);
    const alta = exito(await casos.altaDeEmpresa(comoAdminAhora(), entrada));
    return { ...alta, marca: m, entrada };
  }
  const estadoDe = async (empresa: string) =>
    (await una<{ estado: string }>("select estado from empresa where id = $1", [empresa])).estado;
  const constanciasDe = (empresa: string) =>
    todas<{ actor: string; antes: Record<string, unknown>; despues: Record<string, unknown> }>(
      "select actor, antes, despues from auditoria_plataforma where accion = 'ALTA_CANCELADA' and entidad_id = $1 order by id",
      [empresa],
    );
  /** Envejece el alta: la empresa se creó hace `horas` respecto de `ahora`. */
  const envejecer = (empresa: string, ahora: Date, horas: number) =>
    dueno.query("update empresa set creado_en = $2 where id = $1", [
      empresa,
      new Date(ahora.getTime() - horas * HORA),
    ]);
  const comoElSistema = (ahora: Date): ContextoDePlataforma =>
    plataformaEn(ahora, { tipo: "SISTEMA", proceso: "barrido-de-altas" });

  describe("cancelar a mano", () => {
    it("pasa la empresa a CANCELLED con el motivo, revoca la invitación del gerente y deja la constancia con el actor", async () => {
      const a = await unaAlta();
      const r = exito(
        await casos.cancelarAlta(comoAdminAhora(), {
          claveDeIdempotencia: claveAlAzar(),
          empresaId: a.empresaId,
          motivo: "  el cliente se arrepintió ",
        }),
      );
      expect(r).toEqual({
        empresaId: a.empresaId,
        invitacionRevocada: a.invitacionId,
        repetida: false,
      });
      expect(
        await una("select estado, motivo_estado from empresa where id = $1", [a.empresaId]),
      ).toEqual({ estado: "CANCELLED", motivo_estado: "el cliente se arrepintió" });
      expect(
        await una(
          "select estado, motivo_revocacion, revocada_en is not null as revocada from invitacion where id = $1",
          [a.invitacionId],
        ),
      ).toEqual({ estado: "REVOCADA", motivo_revocacion: "ALTA_CANCELADA", revocada: true });
      expect(await constanciasDe(a.empresaId)).toEqual([
        {
          actor: ADMIN_DE_PRUEBA,
          antes: { estado: "PROVISIONING" },
          despues: {
            estado: "CANCELLED",
            motivo: "el cliente se arrepintió",
            tenantId: a.tenantId,
            invitacionRevocada: a.invitacionId,
          },
        },
      ]);
    });

    it("libera el CUIT: se puede dar de alta de nuevo con el mismo", async () => {
      const a = await unaAlta();
      exito(
        await casos.cancelarAlta(comoAdminAhora(), {
          claveDeIdempotencia: claveAlAzar(),
          empresaId: a.empresaId,
          motivo: "datos mal cargados",
        }),
      );
      const de_nuevo = exito(
        await casos.altaDeEmpresa(
          comoAdminAhora(),
          altaNueva(a.marca.marca, { cuit: a.entrada.cuit }),
        ),
      );
      expect(de_nuevo.empresaId).not.toBe(a.empresaId);
    });

    it("la misma clave devuelve lo mismo (repetida) y no vuelve a cancelar ni a auditar", async () => {
      const a = await unaAlta();
      const pedido = {
        claveDeIdempotencia: claveAlAzar(),
        empresaId: a.empresaId,
        motivo: "se cayó el trato",
      };
      const primera = exito(await casos.cancelarAlta(comoAdminAhora(), pedido));
      const segunda = exito(await casos.cancelarAlta(comoAdminAhora(), pedido));
      expect(segunda).toEqual({ ...primera, repetida: true });
      expect(await constanciasDe(a.empresaId)).toHaveLength(1);
    });

    it("la misma clave con otro motivo u otra empresa es CLAVE_REUTILIZADA", async () => {
      const a = await unaAlta();
      const b = await unaAlta();
      const pedido = {
        claveDeIdempotencia: claveAlAzar(),
        empresaId: a.empresaId,
        motivo: "se cayó el trato",
      };
      exito(await casos.cancelarAlta(comoAdminAhora(), pedido));
      expect(falla(await casos.cancelarAlta(comoAdminAhora(), { ...pedido, motivo: "otro" }))).toBe(
        "CLAVE_REUTILIZADA",
      );
      expect(
        falla(await casos.cancelarAlta(comoAdminAhora(), { ...pedido, empresaId: b.empresaId })),
      ).toBe("CLAVE_REUTILIZADA");
      expect(await estadoDe(b.empresaId)).toBe("PROVISIONING");
    });

    it("sin motivo es MOTIVO_OBLIGATORIO; una empresa que no existe, EMPRESA_NO_ENCONTRADA; un id malo, ID_INVALIDO", async () => {
      const a = await unaAlta();
      const cancelar = (empresa: string, motivo = "razón") =>
        casos.cancelarAlta(comoAdminAhora(), {
          claveDeIdempotencia: claveAlAzar(),
          empresaId: empresa,
          motivo,
        });
      for (const motivo of ["", "   ", "\n\t"]) {
        expect(falla(await cancelar(a.empresaId, motivo))).toBe("MOTIVO_OBLIGATORIO");
      }
      expect(falla(await cancelar("0a1b2c3d-0000-4000-8000-0000000000ee"))).toBe(
        "EMPRESA_NO_ENCONTRADA",
      );
      expect(falla(await cancelar("no-es-un-uuid"))).toBe("ID_INVALIDO");
      expect(await estadoDe(a.empresaId)).toBe("PROVISIONING");
      expect(await constanciasDe(a.empresaId)).toEqual([]);
    });

    it("una empresa que ya no está en alta (activa o cancelada) es ALTA_NO_PENDIENTE y no cambia nada", async () => {
      const activa = await unaAlta();
      await dueno.query("update empresa set estado = 'ACTIVE' where id = $1", [activa.empresaId]);
      const cancelada = await unaAlta();
      await dueno.query(
        "update empresa set estado = 'CANCELLED', motivo_estado = 'antes' where id = $1",
        [cancelada.empresaId],
      );
      for (const [e, estado] of [
        [activa, "ACTIVE"],
        [cancelada, "CANCELLED"],
      ] as const) {
        expect(
          falla(
            await casos.cancelarAlta(comoAdminAhora(), {
              claveDeIdempotencia: claveAlAzar(),
              empresaId: e.empresaId,
              motivo: "razón",
            }),
          ),
        ).toBe("ALTA_NO_PENDIENTE");
        expect(await estadoDe(e.empresaId)).toBe(estado);
        expect(await constanciasDe(e.empresaId)).toEqual([]);
      }
    });

    it("un alta cuya invitación ya se revocó o venció también se cancela (no queda nada pendiente que revocar)", async () => {
      const revocada = await unaAlta();
      await dueno.query(
        "update invitacion set estado = 'REVOCADA', revocada_en = now(), motivo_revocacion = 'REVOCADA_POR_PLATAFORMA' where id = $1",
        [revocada.invitacionId],
      );
      const r = exito(
        await casos.cancelarAlta(comoAdminAhora(), {
          claveDeIdempotencia: claveAlAzar(),
          empresaId: revocada.empresaId,
          motivo: "razón",
        }),
      );
      expect(r.invitacionRevocada).toBeNull();
      expect(await estadoDe(revocada.empresaId)).toBe("CANCELLED");

      // Una invitación vencida pero todavía guardada como PENDIENTE (el vencimiento no se guarda), armada
      // con fechas pasadas: ninguna alta real nace ya vencida.
      const m = await crearMarcaLista(dueno);
      const mundo = await crearTenantConPlan(dueno, m, { empresasPorTenant: "5" });
      const enAlta = await dueno.query<{ id: string }>(
        "insert into empresa (tenant_id, cuit, razon_social) values ($1, $2, 'Vencida S.A.') returning id",
        [mundo.tenant, cuitAlAzar()],
      );
      const vencida = {
        empresaId: enAlta.rows[0]?.id as string,
        invitacionId: "",
      };
      const inv = await crearInvitacionDeBase(dueno, {
        tenant: mundo.tenant,
        tipo: "ALTA_GERENTE",
        emitidaEn: new Date("2026-10-01T10:00:00Z"),
        venceEn: new Date("2026-10-02T10:00:00Z"),
      });
      await incluirEmpresa(dueno, inv, vencida.empresaId, "GERENTE");
      vencida.invitacionId = inv.id;
      const v = exito(
        await casos.cancelarAlta(comoAdminAhora(), {
          claveDeIdempotencia: claveAlAzar(),
          empresaId: vencida.empresaId,
          motivo: "razón",
        }),
      );
      // Una invitación vencida sigue guardada como PENDIENTE: se revoca igual.
      expect(v.invitacionRevocada).toBe(vencida.invitacionId);
    });

    it("SOPORTE, el sistema y un administrador dado de baja: SIN_PERMISO, y no cambia nada", async () => {
      const a = await unaAlta();
      for (const contexto of [comoSoporteAhora(), comoElSistema(new Date())]) {
        expect(
          falla(
            await casos.cancelarAlta(contexto, {
              claveDeIdempotencia: claveAlAzar(),
              empresaId: a.empresaId,
              motivo: "razón",
            }),
          ),
        ).toBe("SIN_PERMISO");
      }
      expect(await estadoDe(a.empresaId)).toBe("PROVISIONING");
    });

    it("la cancelación es todo o nada: si falla la constancia, la empresa sigue en alta y la invitación pendiente", async () => {
      const a = await unaAlta();
      const roto = crearEntornoDeAlta(propia.base, 3, (tx) => ({
        ...tx,
        auditoriaDePlataforma: {
          registrar: async (...args) => {
            await tx.auditoriaDePlataforma.registrar(...args);
            throw new Error("falla inyectada después de la constancia");
          },
        },
      }));
      try {
        await expect(
          crearCasosDeAlta(roto).cancelarAlta(comoAdminAhora(), {
            claveDeIdempotencia: claveAlAzar(),
            empresaId: a.empresaId,
            motivo: "razón",
          }),
        ).rejects.toThrow("falla inyectada");
      } finally {
        await roto.cerrar();
      }
      expect(await estadoDe(a.empresaId)).toBe("PROVISIONING");
      expect(
        (
          await una<{ estado: string }>("select estado from invitacion where id = $1", [
            a.invitacionId,
          ])
        ).estado,
      ).toBe("PENDIENTE");
      expect(await constanciasDe(a.empresaId)).toEqual([]);
    });
  });

  describe("el mail del gerente de un alta cancelada no sale", () => {
    const manejador = (enviados: MensajeDeCorreo[]) => {
      const correo: Correo = {
        enviar: (mensaje) => {
          enviados.push(mensaje);
          return Promise.resolve({ tipo: "ENVIADO", idDelProveedor: "prov-1" });
        },
      };
      return crearManejadorDeEnviarInvitacion({
        transacciones: entornoGeneral,
        tokens,
        correo,
        urlBase: "https://app.ejemplo.test",
        marca: { nombre: "ZuluHub" },
      });
    };
    const trabajoDe = (empresa: string, invitacion: string): TrabajoTomado => ({
      id: "t-1",
      empresaId: empresaId(empresa),
      tipo: "enviar_invitacion",
      datos: { invitacionId: invitacion },
      intentos: 1,
    });

    it("con el alta vigente, el manejador de la cola envía UN mail al gerente (una empresa en alta sí lo recibe)", async () => {
      const a = await unaAlta();
      const enviados: MensajeDeCorreo[] = [];
      const r = await manejador(enviados)(trabajoDe(a.empresaId, a.invitacionId), new Date());
      expect(r).toEqual({ tipo: "HECHO" });
      expect(enviados).toHaveLength(1);
      expect(enviados[0]?.para).toBe(a.entrada.emailGerente.toLowerCase());
      expect(enviados[0]?.texto).toContain(`https://app.ejemplo.test/`);
    });

    it("cancelada el alta, el mismo trabajo termina sin mandar nada (OMITIDO: la invitación fue revocada)", async () => {
      const a = await unaAlta();
      exito(
        await casos.cancelarAlta(comoAdminAhora(), {
          claveDeIdempotencia: claveAlAzar(),
          empresaId: a.empresaId,
          motivo: "razón",
        }),
      );
      const enviados: MensajeDeCorreo[] = [];
      const r = await manejador(enviados)(trabajoDe(a.empresaId, a.invitacionId), new Date());
      expect(r.tipo).toBe("HECHO");
      expect(r.tipo === "HECHO" ? r.nota : null).toContain("OMITIDO");
      expect(enviados).toEqual([]);
    });
  });

  describe("el barrido de altas vencidas", () => {
    // Deja la base sin altas vencidas de las demás pruebas: los resúmenes se comparan enteros.
    beforeEach(async () => {
      exito(await casos.cancelarAltasVencidas(comoElSistema(new Date())));
    });

    it("cancela las vencidas (72 h al milisegundo), deja las vigentes, las activas y las ya canceladas, con el motivo y el actor sistema", async () => {
      const ahora = new Date();
      const vencida = await unaAlta();
      const justo = await unaAlta();
      const casi = await unaAlta();
      const activa = await unaAlta();
      const yaCancelada = await unaAlta();
      await envejecer(vencida.empresaId, ahora, 100);
      await envejecer(justo.empresaId, ahora, 72); // justo en el plazo: vence
      await dueno.query("update empresa set creado_en = $2 where id = $1", [
        casi.empresaId,
        new Date(ahora.getTime() - 72 * HORA + 1),
      ]); // 1 ms antes: todavía vale
      await envejecer(activa.empresaId, ahora, 200);
      await dueno.query("update empresa set estado = 'ACTIVE' where id = $1", [activa.empresaId]);
      await envejecer(yaCancelada.empresaId, ahora, 200);
      await dueno.query(
        "update empresa set estado = 'CANCELLED', motivo_estado = 'antes' where id = $1",
        [yaCancelada.empresaId],
      );

      const r = exito(await casos.cancelarAltasVencidas(comoElSistema(ahora)));
      // Las altas de las demás pruebas de este archivo (recién creadas) no cuentan: se mira solo las propias.
      const mias = [vencida.empresaId, justo.empresaId];
      expect(
        [...r.canceladas]
          .filter((e) => [vencida, justo, casi, activa, yaCancelada].some((x) => x.empresaId === e))
          .sort(),
      ).toEqual([...mias].sort());
      expect(r.fallidas).toEqual([]);
      expect(await estadoDe(vencida.empresaId)).toBe("CANCELLED");
      expect(await estadoDe(justo.empresaId)).toBe("CANCELLED");
      expect(await estadoDe(casi.empresaId)).toBe("PROVISIONING");
      expect(await estadoDe(activa.empresaId)).toBe("ACTIVE");
      expect(await estadoDe(yaCancelada.empresaId)).toBe("CANCELLED");
      expect(
        await una("select motivo_estado from empresa where id = $1", [vencida.empresaId]),
      ).toEqual({ motivo_estado: "ALTA_VENCIDA" });
      expect(
        await una<{ estado: string; motivo_revocacion: string }>(
          "select estado, motivo_revocacion from invitacion where id = $1",
          [vencida.invitacionId],
        ),
      ).toEqual({ estado: "REVOCADA", motivo_revocacion: "ALTA_CANCELADA" });
      expect((await constanciasDe(vencida.empresaId))[0]).toMatchObject({
        actor: "sistema",
        antes: { estado: "PROVISIONING" },
        despues: {
          estado: "CANCELLED",
          motivo: "ALTA_VENCIDA",
          invitacionRevocada: vencida.invitacionId,
        },
      });
      expect(await constanciasDe(casi.empresaId)).toEqual([]);
      expect(await constanciasDe(activa.empresaId)).toEqual([]);
    });

    it("es repetible: la segunda corrida no encuentra nada ni vuelve a auditar", async () => {
      const ahora = new Date();
      const a = await unaAlta();
      await envejecer(a.empresaId, ahora, 80);
      const primera = exito(await casos.cancelarAltasVencidas(comoElSistema(ahora)));
      expect(primera.canceladas).toContain(a.empresaId);
      const constancias = await cuenta(
        "select count(*)::int as n from auditoria_plataforma where accion = 'ALTA_CANCELADA'",
      );
      const segunda = exito(await casos.cancelarAltasVencidas(comoElSistema(ahora)));
      expect(segunda).toEqual({ revisadas: 0, canceladas: [], yaNoPendientes: [], fallidas: [] });
      expect(
        await cuenta(
          "select count(*)::int as n from auditoria_plataforma where accion = 'ALTA_CANCELADA'",
        ),
      ).toBe(constancias);
    });

    it("respeta el tope por corrida: las que sobran las toma la corrida siguiente", async () => {
      const ahora = new Date();
      const entornoAcotado = crearEntornoDeAlta(propia.base, 3);
      try {
        const acotado = crearCasosDeUsoDeAltasConTope(entornoAcotado, 2);
        const grupo = [await unaAlta(), await unaAlta(), await unaAlta()];
        for (const a of grupo) await envejecer(a.empresaId, ahora, 90);
        const vivas = async () => {
          let n = 0;
          for (const a of grupo) n += (await estadoDe(a.empresaId)) === "PROVISIONING" ? 1 : 0;
          return n;
        };
        // Las demás pruebas del archivo dejan altas propias sin vencer: solo cuentan las vencidas.
        const uno = exito(await acotado.cancelarAltasVencidas(comoElSistema(ahora)));
        expect(uno.revisadas).toBe(2);
        expect(uno.canceladas).toHaveLength(2);
        let corridas = 0;
        while ((await vivas()) > 0 && corridas++ < 5) {
          exito(await acotado.cancelarAltasVencidas(comoElSistema(ahora)));
        }
        expect(await vivas()).toBe(0);
      } finally {
        await entornoAcotado.cerrar();
      }
    });

    it("una falla en una empresa no frena a las demás y queda en el resumen", async () => {
      const ahora = new Date();
      const buena = await unaAlta();
      const mala = await unaAlta();
      await envejecer(buena.empresaId, ahora, 90);
      await envejecer(mala.empresaId, ahora, 91);
      // Provocamos un error de la base (no una excepción nuestra) justo al cancelar la mala.
      const roto = crearEntornoDeAlta(propia.base, 3, (tx) => ({
        ...tx,
        empresas: {
          ...tx.empresas,
          cambiarEstado: async (id, version, cambio) => {
            if (id === mala.empresaId) await sql`select 1 / 0`.execute(tx.db);
            return tx.empresas.cambiarEstado(id, version, cambio);
          },
        },
      }));
      try {
        const r = exito(await crearCasosDeAlta(roto).cancelarAltasVencidas(comoElSistema(ahora)));
        expect(r.canceladas).toContain(buena.empresaId);
        expect(r.canceladas).not.toContain(mala.empresaId);
        expect(r.fallidas.map((f) => f.empresaId)).toEqual([mala.empresaId]);
        expect(r.fallidas[0]?.error).toMatchObject({ tipo: "Inesperado" });
      } finally {
        await roto.cerrar();
      }
      expect(await estadoDe(buena.empresaId)).toBe("CANCELLED");
      expect(await estadoDe(mala.empresaId)).toBe("PROVISIONING");
      // La mala quedó entera: invitación pendiente y sin constancia.
      expect(
        (
          await una<{ estado: string }>("select estado from invitacion where id = $1", [
            mala.invitacionId,
          ])
        ).estado,
      ).toBe("PENDIENTE");
      expect(await constanciasDe(mala.empresaId)).toEqual([]);
    });

    it("solo lo corre el sistema: un administrador, o un contexto ajeno, lanzan antes de abrir una transacción", async () => {
      await expect(casos.cancelarAltasVencidas(comoAdminAhora())).rejects.toThrow(RangeError);
      await expect(
        casos.cancelarAltasVencidas({
          tipo: "TRABAJOS",
          ahora: new Date(),
        } as unknown as ContextoDePlataforma),
      ).rejects.toThrow(RangeError);
    });
  });

  describe("carreras", () => {
    const VUELTAS = 8;

    /**
     * Aceptar el alta y cancelarla/barrerla a la vez, con barrera: los dos leen la empresa en alta antes de
     * que ninguno escriba. Gana uno solo (SERIALIZABLE); el perdedor ve el estado nuevo.
     */
    async function carrera(cancelador: "manual" | "barrido") {
      const m = await crearMarcaLista(dueno);
      const email = emailAlAzar("gerente");
      const entrada = altaNueva(m.marca, { emailGerente: email });
      const alta = exito(await casos.altaDeEmpresa(comoAdminAhora(), entrada));
      const ahora = new Date();
      await envejecer(alta.empresaId, ahora, 100);

      // Una sola cita para los dos lados: ambos leen la empresa en alta antes de que ninguno escriba.
      const cita = crearBarrera(2);
      const entornoCancela = crearEntornoDeAlta(propia.base, 4, (tx) => ({
        ...tx,
        empresas: {
          ...tx.empresas,
          // El barrido lee con `obtenerConCreadoEn`; la cancelación a mano, con `obtener`. Solo la empresa de
          // la carrera espera (el barrido puede revisar otras).
          obtener: async (...a) => {
            const r = await tx.empresas.obtener(...a);
            if (a[0] === alta.empresaId) await cita();
            return r;
          },
          obtenerConCreadoEn: async (...a) => {
            const r = await tx.empresas.obtenerConCreadoEn(...a);
            if (a[0] === alta.empresaId) await cita();
            return r;
          },
        },
      }));
      const entornoAcepta = crearEntornoDePrueba(propia.base, 4, (tx) => ({
        ...tx,
        invitaciones: {
          ...tx.invitaciones,
          obtenerPorHash: async (...a) => {
            const r = await tx.invitaciones.obtenerPorHash(...a);
            await cita();
            return r;
          },
        },
      }));
      try {
        const identidad = crearCasosDeUsoDeIdentidad({
          transacciones: entornoAcepta,
          tokens,
          reglas: REGLAS_DE_EMPRESA,
        });
        const token = tokens.derivar(invitacionId(alta.invitacionId));
        const aceptar = identidad.aceptarInvitacion({
          token,
          emailAutenticado: email,
          usuarioAuth: usuarioDePrueba(email),
          marcaDeEntrada: marcaComercialId(m.marca),
          ahora: new Date(),
        });
        const deCancelacion = crearCasosDeAlta(entornoCancela, tokens);
        const [aceptada, manual, barrido] = await Promise.all([
          aceptar,
          cancelador === "manual"
            ? deCancelacion.cancelarAlta(comoAdminAhora(), {
                claveDeIdempotencia: claveAlAzar(),
                empresaId: alta.empresaId,
                motivo: "razón",
              })
            : Promise.resolve(null),
          cancelador === "barrido"
            ? deCancelacion.cancelarAltasVencidas(comoElSistema(ahora))
            : Promise.resolve(null),
        ]);
        return { alta, aceptada, manual, barrido, email };
      } finally {
        await entornoCancela.cerrar();
        await entornoAcepta.cerrar();
      }
    }

    it("aceptar contra cancelar a mano: gana uno solo y el otro ve el estado nuevo (ALTA_NO_PENDIENTE)", async () => {
      // Las barreras de este test esperan una lectura de cada lado: si un lado nunca llega a leer, no hay carrera.
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { alta, aceptada, manual } = await carrera("manual");
        const cancelada = manual ?? falsoSiNoHay();
        const estado = await estadoDe(alta.empresaId);
        const gana = (aceptada.ok ? 1 : 0) + (cancelada.ok ? 1 : 0);
        expect(gana, `vuelta ${vuelta}: ${JSON.stringify({ aceptada, cancelada })}`).toBe(1);
        if (aceptada.ok) {
          expect(estado).toBe("ACTIVE");
          expect(falla(cancelada)).toBe("ALTA_NO_PENDIENTE");
          expect(
            (
              await una<{ estado: string }>("select estado from invitacion where id = $1", [
                alta.invitacionId,
              ])
            ).estado,
          ).toBe("ACEPTADA");
        } else {
          expect(estado).toBe("CANCELLED");
          expect(falla(aceptada)).toBe("ALTA_NO_PENDIENTE");
          expect(
            (
              await una<{ estado: string }>("select estado from invitacion where id = $1", [
                alta.invitacionId,
              ])
            ).estado,
          ).toBe("REVOCADA");
          expect(
            await cuenta("select count(*)::int as n from membresia where empresa_id = $1", [
              alta.empresaId,
            ]),
          ).toBe(0);
        }
      }
    });

    it("aceptar contra el barrido: gana uno solo; el barrido no cancela un alta que se activó", async () => {
      for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
        const { alta, aceptada, barrido } = await carrera("barrido");
        const estado = await estadoDe(alta.empresaId);
        const resumen = exito(barrido ?? falsoSiNoHay());
        if (aceptada.ok) {
          expect(estado, `vuelta ${vuelta}`).toBe("ACTIVE");
          expect(resumen.canceladas).not.toContain(alta.empresaId);
          expect(resumen.yaNoPendientes).toContain(alta.empresaId);
        } else {
          expect(estado, `vuelta ${vuelta}`).toBe("CANCELLED");
          expect(falla(aceptada)).toBe("ALTA_NO_PENDIENTE");
          expect(resumen.canceladas).toContain(alta.empresaId);
        }
      }
    });

    it("dos barridos a la vez: cada alta vencida se cancela UNA vez y se audita una sola vez", async () => {
      for (let vuelta = 0; vuelta < 5; vuelta++) {
        const ahora = new Date();
        const a = await unaAlta();
        await envejecer(a.empresaId, ahora, 100);
        const rs = await Promise.all([
          casos.cancelarAltasVencidas(comoElSistema(ahora)),
          casos.cancelarAltasVencidas(comoElSistema(ahora)),
        ]);
        const resumenes = rs.map(exito);
        expect(resumenes.flatMap((r) => r.fallidas)).toEqual([]);
        expect(
          resumenes.flatMap((r) => r.canceladas).filter((e) => e === a.empresaId),
        ).toHaveLength(1);
        expect(await constanciasDe(a.empresaId), `vuelta ${vuelta}`).toHaveLength(1);
        expect(await estadoDe(a.empresaId)).toBe("CANCELLED");
      }
    });

    it("cancelar a mano contra el barrido: se cancela una sola vez; el que llega segundo no es un error del barrido", async () => {
      for (let vuelta = 0; vuelta < 5; vuelta++) {
        const ahora = new Date();
        const a = await unaAlta();
        await envejecer(a.empresaId, ahora, 100);
        const [manual, barrido] = await Promise.all([
          casos.cancelarAlta(comoAdminAhora(), {
            claveDeIdempotencia: claveAlAzar(),
            empresaId: a.empresaId,
            motivo: "razón",
          }),
          casos.cancelarAltasVencidas(comoElSistema(ahora)),
        ]);
        const resumen = exito(barrido);
        expect(resumen.fallidas).toEqual([]);
        expect(await constanciasDe(a.empresaId), `vuelta ${vuelta}`).toHaveLength(1);
        if (manual.ok) expect(resumen.canceladas).not.toContain(a.empresaId);
        else expect(falla(manual)).toBe("ALTA_NO_PENDIENTE");
      }
    });
  });
});

/** Los casos de uso del alta con un tope de altas por corrida del barrido distinto del normal. */
function crearCasosDeUsoDeAltasConTope(
  entorno: TransaccionesDePostgres<TxDeAltaDePrueba>,
  limite: number,
): CasosDeUsoDeAltas {
  return crearCasosDeUsoDeAltas({
    altaDeEmpresa: {
      transacciones: entorno,
      reglas: REGLAS_DE_PLATAFORMA,
      tokens: tokensDePrueba(),
      catalogoDeModulos: MODULOS_DE_PRUEBA,
    },
    cancelarAlta: { transacciones: entorno, reglas: REGLAS_DE_PLATAFORMA },
    cancelarAltasVencidas: { transacciones: entorno, limite },
    reenviarInvitacionDelAlta: {
      transacciones: entorno,
      reglas: REGLAS_DE_PLATAFORMA,
      tokens: tokensDePrueba(),
    },
    revocarInvitacionDelAlta: { transacciones: entorno, reglas: REGLAS_DE_PLATAFORMA },
  });
}

import { describe, expect, it } from "vitest";
import type { Contexto } from "../../../contexto/contexto";
import type { EstadoDeEmpresa, EstadoDeTenant } from "../../../contexto/estados";
import { cuitDesdeTexto, type Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import {
  empresaId,
  invitacionId,
  sucursalId,
  tenantId,
} from "../../../primitivas/identificadores/marca";
import type { TrabajoTomado } from "../../../puertos/cola-de-trabajos";
import type { Correo, MensajeDeCorreo, ResultadoDeEnvio } from "../../../puertos/correo";
import type { RegistroDeAuditoria } from "../../../puertos/auditoria";
import type { Transacciones } from "../../../puertos/transacciones";
import type { Empresa } from "../../empresas/publico";
import type { Tenant } from "../../tenants/publico";
import type { Email } from "../dominio/email";
import type { Invitacion } from "../dominio/invitacion";
import { crearManejadorDeEnviarInvitacion, type TxDeEnvioDeInvitacion } from "./enviar-invitacion";

/**
 * El manejador de `enviar_invitacion` contra repositorios en memoria. La base real (RLS, contexto
 * firmado) se prueba en `test/integracion/trabajos-envio-invitacion.test.ts`.
 */
const AHORA = new Date("2026-10-11T12:00:00.000Z");
const mas = (ms: number) => new Date(AHORA.getTime() + ms);
const URL_BASE = "https://app.ejemplo.test";
const MARCA = "Marca de Prueba";
const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const EMPRESA = empresaId("0b0f6d6e-5c44-4b87-9b5c-1d2a3c4d5e6f");
const TOKEN = "TOKEN-secreto-derivado-de-la-invitacion-1234567890";
const CUIT = cuitDesdeTexto("20123456786");

function invitacion(cambios: Partial<Invitacion> = {}): Invitacion {
  return {
    id: invitacionId(ID),
    tenantId: tenantId("t-1"),
    tipo: "USUARIO",
    email: "ana@ejemplo.test" as Email,
    estado: "PENDIENTE",
    emitidaEn: mas(-1_000),
    venceEn: mas(100_000),
    empresas: [{ empresaId: EMPRESA, rol: "OPERADOR", sucursales: [sucursalId("s-1")] }],
    aceptadaPor: null,
    reemplazadaPor: null,
    version: 1,
    ...cambios,
  };
}

function trabajo(cambios: Partial<TrabajoTomado> = {}): TrabajoTomado {
  return {
    id: "trabajo-1",
    empresaId: EMPRESA,
    tipo: "enviar_invitacion",
    datos: { invitacionId: ID },
    intentos: 1,
    ...cambios,
  };
}

type Escenario = {
  invitacion?: Invitacion | null;
  empresa?: EstadoDeEmpresa;
  tenant?: EstadoDeTenant;
  empresaVisible?: boolean;
  tenantVisible?: boolean;
  respuestas?: ResultadoDeEnvio[];
  /** Número (desde 1) de la transacción que devuelve un error de persistencia. */
  fallaLaTransaccion?: number;
};

function armar(escenario: Escenario = {}) {
  const auditoria: RegistroDeAuditoria[] = [];
  const contextos: Contexto[] = [];
  const mensajes: { mensaje: MensajeDeCorreo; clave: string }[] = [];
  const consultadas: string[] = [];
  const respuestas = [...(escenario.respuestas ?? [])];
  const correo: Correo = {
    enviar: (mensaje, clave) => {
      mensajes.push({ mensaje, clave });
      return Promise.resolve(respuestas.shift() ?? { tipo: "ENVIADO", idDelProveedor: "prov-1" });
    },
  };
  const tx = {
    invitaciones: {
      obtenerPorId: (id: string) => {
        consultadas.push(id);
        return Promise.resolve(
          escenario.invitacion === undefined ? invitacion() : escenario.invitacion,
        );
      },
    },
    empresas: {
      obtener: () =>
        Promise.resolve(
          escenario.empresaVisible === false
            ? null
            : ({
                id: EMPRESA,
                tenantId: tenantId("t-1"),
                cuit: (CUIT as { ok: true; valor: Cuit }).valor,
                razonSocial: "Panadería Sol",
                estado: escenario.empresa ?? "ACTIVE",
                motivoEstado: null,
                zonaHoraria: "America/Argentina/Buenos_Aires",
                version: 1,
              } satisfies Empresa),
        ),
    },
    tenants: {
      obtener: () =>
        Promise.resolve(
          escenario.tenantVisible === false
            ? null
            : ({
                id: tenantId("t-1"),
                nombre: "Grupo",
                estado: escenario.tenant ?? "ACTIVE",
                motivoEstado: null,
                version: 1,
              } satisfies Tenant),
        ),
    },
    auditoria: {
      registrar: (registro: RegistroDeAuditoria) => {
        auditoria.push(registro);
        return Promise.resolve();
      },
    },
  } as unknown as TxDeEnvioDeInvitacion;
  const transacciones: Transacciones<TxDeEnvioDeInvitacion> = {
    ejecutar: async (opciones, hacer) => {
      contextos.push(opciones.contexto);
      if (escenario.fallaLaTransaccion === contextos.length) {
        return { ok: false, error: { tipo: "ConcurrenciaAgotada" } } as never;
      }
      return await hacer(tx);
    },
  };
  const manejador = crearManejadorDeEnviarInvitacion({
    transacciones,
    tokens: { derivar: () => TOKEN },
    correo,
    urlBase: URL_BASE,
    marca: { nombre: MARCA },
  });
  return { manejador, auditoria, contextos, mensajes, consultadas };
}

describe("manejador de enviar_invitacion", () => {
  it("envía el mail con la clave invitacion:<id>:envio y el enlace derivado, y audita el envío", async () => {
    const e = armar();
    const r = await e.manejador(trabajo(), AHORA);
    expect(r).toEqual({ tipo: "HECHO" });
    expect(e.mensajes).toHaveLength(1);
    const { mensaje, clave } = e.mensajes[0]!;
    expect(clave).toBe(`invitacion:${ID}:envio`);
    expect(mensaje.para).toBe("ana@ejemplo.test");
    expect(mensaje.asunto).toBe(`Te invitaron a Panadería Sol en ${MARCA}`);
    expect(mensaje.texto).toContain(`en ${MARCA}.`);
    expect(mensaje.texto).toContain(`${URL_BASE}/invitaciones/${TOKEN}`);
    expect(e.auditoria).toEqual([
      {
        empresaId: EMPRESA,
        actorPersonaId: null,
        accion: "INVITACION_ENVIADA",
        entidad: "invitacion",
        entidadId: ID,
        despues: { email: "ana@ejemplo.test", proveedor: "prov-1" },
      },
    ]);
  });

  it("corre con el contexto OPERATIVO de sistema (sin persona) de la empresa del trabajo", async () => {
    const e = armar();
    await e.manejador(trabajo(), AHORA);
    expect(e.contextos).toEqual([
      { tipo: "OPERATIVO", empresaId: EMPRESA, personaId: null, ahora: AHORA },
      { tipo: "OPERATIVO", empresaId: EMPRESA, personaId: null, ahora: AHORA },
    ]);
  });

  it("el token y el enlace no aparecen en la auditoría ni en el resultado", async () => {
    const e = armar();
    const r = await e.manejador(trabajo(), AHORA);
    const visible = JSON.stringify({ r, auditoria: e.auditoria });
    expect(visible).not.toContain(TOKEN);
    expect(visible).not.toContain("/invitaciones/");
  });

  it("ejecutarlo dos veces manda la misma clave y el mismo mensaje (el proveedor no duplica)", async () => {
    const e = armar();
    await e.manejador(trabajo(), AHORA);
    await e.manejador(trabajo({ intentos: 2 }), AHORA);
    expect(e.mensajes).toHaveLength(2);
    expect(e.mensajes[1]).toEqual(e.mensajes[0]);
  });

  it.each([
    ["REVOCADA", { estado: "REVOCADA" }],
    ["ACEPTADA", { estado: "ACEPTADA" }],
    ["VENCIDA", { venceEn: AHORA }],
    ["REEMPLAZADA", { estado: "REVOCADA", reemplazadaPor: invitacionId("inv-2") }],
  ] as const)(
    "una invitación %s no se envía: termina HECHO, deja registro",
    async (motivo, cambios) => {
      const e = armar({ invitacion: invitacion(cambios) });
      const r = await e.manejador(trabajo(), AHORA);
      expect(r).toEqual({ tipo: "HECHO", nota: `OMITIDO: ${motivo}` });
      expect(e.mensajes).toEqual([]);
      expect(e.auditoria).toEqual([
        {
          empresaId: EMPRESA,
          actorPersonaId: null,
          accion: "INVITACION_ENVIO_OMITIDO",
          entidad: "invitacion",
          entidadId: ID,
          despues: { motivo },
        },
      ]);
      // Una sola transacción: no hubo paso de auditoría del envío.
      expect(e.contextos).toHaveLength(1);
    },
  );

  it("si la empresa no opera, no envía y no audita (la auditoría de la aplicación no lo admitiría)", async () => {
    const e = armar({ empresa: "SUSPENDED" });
    const r = await e.manejador(trabajo(), AHORA);
    expect(r).toEqual({ tipo: "HECHO", nota: "OMITIDO: EMPRESA_NO_OPERA" });
    expect(e.mensajes).toEqual([]);
    expect(e.auditoria).toEqual([]);
  });

  it("el alta del gerente con la empresa en PROVISIONING se envía, sin auditar", async () => {
    const e = armar({ invitacion: invitacion({ tipo: "ALTA_GERENTE" }), empresa: "PROVISIONING" });
    const r = await e.manejador(trabajo(), AHORA);
    expect(r).toEqual({ tipo: "HECHO" });
    expect(e.mensajes).toHaveLength(1);
    expect(e.auditoria).toEqual([]);
    expect(e.contextos).toHaveLength(1);
  });

  it("un fallo del correo se informa con su carácter definitivo o reintentable", async () => {
    for (const definitivo of [false, true]) {
      const e = armar({
        respuestas: [{ tipo: "FALLO", definitivo, motivo: "el proveedor respondió 500" }],
      });
      const r = await e.manejador(trabajo(), AHORA);
      expect(r).toEqual({
        tipo: "ERROR",
        error: "correo: el proveedor respondió 500",
        definitivo,
      });
      expect(e.auditoria).toEqual([]);
    }
  });

  it("si el mail salió pero no se pudo auditar, reintenta (la clave evita el duplicado)", async () => {
    const e = armar({ fallaLaTransaccion: 2 });
    const r = await e.manejador(trabajo(), AHORA);
    expect(r).toEqual({
      tipo: "ERROR",
      error: "el mail salió pero no se pudo auditar (ConcurrenciaAgotada)",
      definitivo: false,
    });
    expect(e.mensajes).toHaveLength(1);
    expect(e.auditoria).toEqual([]);
  });

  it("los datos del trabajo sin invitacionId válida son un error definitivo y no tocan nada", async () => {
    for (const datos of [
      {},
      { invitacionId: 5 },
      { invitacionId: "no-es-un-uuid" },
      { invitacionId: "" },
    ]) {
      const e = armar();
      const r = await e.manejador(trabajo({ datos }), AHORA);
      expect(r).toEqual({
        tipo: "ERROR",
        error: "los datos del trabajo no traen una invitacionId válida",
        definitivo: true,
      });
      expect(e.contextos).toEqual([]);
      expect(e.mensajes).toEqual([]);
    }
  });

  it("un trabajo de ámbito plataforma (sin empresa) es un error definitivo", async () => {
    const e = armar();
    const r = await e.manejador(trabajo({ empresaId: null }), AHORA);
    expect(r).toMatchObject({ tipo: "ERROR", definitivo: true });
    expect(e.contextos).toEqual([]);
    expect(e.mensajes).toEqual([]);
  });

  it("si la invitación no es visible para la empresa del trabajo, error definitivo y nada se envía", async () => {
    const e = armar({ invitacion: null });
    const r = await e.manejador(trabajo(), AHORA);
    expect(r).toEqual({
      tipo: "ERROR",
      error: "la invitación no existe para la empresa del trabajo",
      definitivo: true,
    });
    expect(e.mensajes).toEqual([]);
    expect(e.auditoria).toEqual([]);
  });

  it("un error de persistencia es reintentable y no filtra detalle", async () => {
    const e = armar({ fallaLaTransaccion: 1 });
    const r = await e.manejador(trabajo(), AHORA);
    expect(r).toEqual({
      tipo: "ERROR",
      error: "persistencia: ConcurrenciaAgotada",
      definitivo: false,
    });
    expect(e.mensajes).toEqual([]);
  });

  it("si la empresa o el tenant no se ven, lanza (el procesador lo trata como reintentable)", async () => {
    await expect(armar({ empresaVisible: false }).manejador(trabajo(), AHORA)).rejects.toThrow(
      /no es visible/,
    );
    await expect(armar({ tenantVisible: false }).manejador(trabajo(), AHORA)).rejects.toThrow(
      /no es visible/,
    );
  });
});

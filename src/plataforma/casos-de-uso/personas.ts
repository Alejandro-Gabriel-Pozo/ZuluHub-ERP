import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  TRABAJO_REVOCAR_SESIONES,
  claveDeRevocacionDeSesiones,
  type MembresiasParaPlataforma,
  type RepositorioDePersonas,
} from "../../modulos/identidad/publico";
import {
  personaId as aPersonaId,
  type EmpresaId,
  type PersonaId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { Auditoria } from "../../puertos/auditoria";
import type { AccionDePlataforma } from "../../puertos/auditoria-de-plataforma";
import type { Trabajos } from "../../puertos/trabajos";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import {
  decidirReactivacionDePersona,
  decidirSuspensionDePersona,
  type ErrorDeReactivacionDePersona,
  type ErrorDeSuspensionDePersona,
} from "../dominio/persona";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import {
  ejecutarCasoDePlataforma,
  type DependenciasDeCasoDePlataforma,
  type ErrorComunDeCasoDePlataforma,
  type TxDeCasoDePlataforma,
} from "./caso-de-plataforma";

/**
 * Suspender y reactivar una persona de todo el sistema (H5 §B.5.6). Solo ADMIN. El corte es INMEDIATO: cada
 * caso de uso de empresa lee `activo_global` dentro de su transacción, así que la persona suspendida deja de
 * poder hacer nada en la operación siguiente, en todas sus empresas y tenants. Deja la constancia de
 * plataforma (`PERSONA_SUSPENDIDA`, `PERSONA_REACTIVADA`) y una fila en la auditoría de CADA empresa donde la
 * persona tiene una membresía activa (así el gerente ve por qué dejó de entrar). Sin el email de la persona
 * en ninguna constancia.
 *
 * Revocación de sesiones (h5-p8 §2.5): al SUSPENDER, el caso encola el trabajo `revocar_sesiones` en la MISMA transacción
 * (si el caso se revierte, no queda el trabajo; si se confirma, queda), con el usuario de la librería de ingreso que la
 * persona tiene vinculado (`persona.usuario_auth_id`, leído acá: el rol de trabajos no ve las personas y el de
 * autenticación no ve nada de negocio). Una persona que nunca ingresó (sin usuario vinculado) no tiene sesiones y no
 * encola nada. La clave `persona:<id>:suspension:<clave del pedido>` hace que repetir el pedido no duplique el
 * trabajo. Reactivar no encola nada: las sesiones revocadas no vuelven, se ingresa de nuevo. Entre confirmar y que el
 * procesador corra la sesión puede seguir viva, pero sin ningún permiso (cada caso lee `activo_global`).
 */

export type TxDePersonas = TxDeCasoDePlataforma &
  Readonly<{
    personas: RepositorioDePersonas;
    membresias: MembresiasParaPlataforma;
    /** La auditoría de cada empresa afectada (`auditoria_empresa`). */
    auditoria: Auditoria;
    /** Para encolar `revocar_sesiones` en la misma transacción. */
    trabajos: Trabajos;
  }>;

export type DependenciasDePersonas = DependenciasDeCasoDePlataforma<TxDePersonas>;

export const OPERACIONES_DE_PERSONAS = {
  suspenderPersona: "personas.suspender",
  reactivarPersona: "personas.reactivar",
} as const;

export const DECLARACIONES_DE_PERSONAS = {
  suspenderPersona: { accion: "personas.suspender" },
  reactivarPersona: { accion: "personas.reactivar" },
} as const satisfies Record<string, DeclaracionDeAccionDePlataforma>;

export type EntradaDeSuspenderPersona = Readonly<{
  claveDeIdempotencia: string;
  personaId: string;
  /** Obligatorio: por qué se suspende. Queda en la constancia (la persona no tiene dónde guardarlo). */
  motivo: string;
}>;
export type EntradaDeReactivarPersona = Readonly<{
  claveDeIdempotencia: string;
  personaId: string;
}>;

export type SalidaDeCambioDePersona = Readonly<{
  personaId: PersonaId;
  /** Si la persona quedó activa en todo el sistema. */
  activa: boolean;
  /** En cuántas empresas (con membresía activa) quedó constancia. */
  empresasAfectadas: number;
  /** `true` cuando esta llamada repite una anterior con la misma clave: no cambió nada. */
  repetida: boolean;
}>;

export type ErrorAlCambiarLaPersona =
  | ErrorComunDeCasoDePlataforma
  | ErrorDeSuspensionDePersona
  | ErrorDeReactivacionDePersona
  | "ID_INVALIDO"
  | "PERSONA_NO_ENCONTRADA"
  | "VERSION_DESACTUALIZADA";

type Definicion = Readonly<{
  declaracion: DeclaracionDeAccionDePlataforma;
  operacion: string;
  constancia: AccionDePlataforma;
  /** El valor de `activo_global` al que pasa. */
  activa: boolean;
  /** Si el cambio corta las sesiones de la persona (la suspensión sí; la reactivación no). */
  revocaSesiones: boolean;
}>;

function armarCambioDePersona<Entrada extends { claveDeIdempotencia: string; personaId: string }>(
  dependencias: DependenciasDePersonas,
  definicion: Definicion,
  /** Decide con la persona leída; devuelve el motivo a guardar en la constancia (o `null` si no lleva). */
  decidir: (
    persona: Readonly<{ activoGlobal: boolean }>,
    entrada: Entrada,
  ) => Resultado<
    Readonly<{ motivo: string | null }>,
    ErrorDeSuspensionDePersona | ErrorDeReactivacionDePersona
  >,
  /** Lo que de la entrada entra a la huella además de la persona. */
  motivoDeLaHuella: (entrada: Entrada) => string | null,
) {
  return async function cambiarPersona(
    contexto: ContextoDePlataforma,
    entrada: Entrada,
  ): Promise<Resultado<SalidaDeCambioDePersona, ErrorAlCambiarLaPersona>> {
    return ejecutarCasoDePlataforma<
      TxDePersonas,
      SalidaDeCambioDePersona,
      PersonaId,
      Exclude<ErrorAlCambiarLaPersona, ErrorComunDeCasoDePlataforma>
    >(dependencias, {
      contexto,
      accion: definicion.declaracion.accion,
      operacion: definicion.operacion,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const id = uuidDesdeTexto(entrada.personaId);
        return id.ok
          ? ok({
              entrada: { personaId: id.valor, motivo: motivoDeLaHuella(entrada) },
              valor: aPersonaId(id.valor),
            })
          : id;
      },
      trabajar: async (tx, id) => {
        const persona = await tx.personas.obtener(id);
        if (persona === null) return err("PERSONA_NO_ENCONTRADA");
        const decision = decidir(persona, entrada);
        if (!decision.ok) return decision;
        // La tabla no tiene versión: el estado esperado hace de control optimista (0 filas = otro lo cambió).
        if (!(await tx.personas.cambiarActivoGlobal(id, definicion.activa))) {
          return err("VERSION_DESACTUALIZADA");
        }
        const empresas: readonly EmpresaId[] = await tx.membresias.empresasConMembresiaActiva(id);
        const { motivo } = decision.valor;
        const despues = { activa: definicion.activa, ...(motivo === null ? {} : { motivo }) };
        // El corte de sesiones se encola en esta transacción; una persona sin usuario vinculado no tiene sesiones.
        if (definicion.revocaSesiones && persona.usuarioAuth !== null) {
          await tx.trabajos.encolar({
            empresaId: null,
            tipo: TRABAJO_REVOCAR_SESIONES,
            datos: { usuarioAuthId: persona.usuarioAuth },
            claveDeIdempotencia: claveDeRevocacionDeSesiones(id, entrada.claveDeIdempotencia),
          });
        }
        for (const empresa of empresas) {
          await tx.auditoria.registrar({
            empresaId: empresa,
            actorPersonaId: null,
            accion: definicion.constancia,
            entidad: "persona",
            entidadId: id,
            antes: { activa: persona.activoGlobal },
            despues,
          });
        }
        return ok({
          salida: {
            personaId: id,
            activa: definicion.activa,
            empresasAfectadas: empresas.length,
            repetida: false,
          },
          constancias: [
            {
              accion: definicion.constancia,
              entidad: "persona",
              entidadId: id,
              antes: { activa: persona.activoGlobal },
              despues: { ...despues, empresasAfectadas: empresas.length },
            },
          ],
        });
      },
      comoRepeticion: (guardado) => ({ ...guardado, repetida: true }),
    });
  };
}

export const armarSuspenderPersona = (d: DependenciasDePersonas) =>
  armarCambioDePersona<EntradaDeSuspenderPersona>(
    d,
    {
      declaracion: DECLARACIONES_DE_PERSONAS.suspenderPersona,
      operacion: OPERACIONES_DE_PERSONAS.suspenderPersona,
      constancia: "PERSONA_SUSPENDIDA",
      activa: false,
      revocaSesiones: true,
    },
    (persona, entrada) => decidirSuspensionDePersona(persona, entrada.motivo),
    (entrada) => entrada.motivo.trim(),
  );

export const armarReactivarPersona = (d: DependenciasDePersonas) =>
  armarCambioDePersona<EntradaDeReactivarPersona>(
    d,
    {
      declaracion: DECLARACIONES_DE_PERSONAS.reactivarPersona,
      operacion: OPERACIONES_DE_PERSONAS.reactivarPersona,
      constancia: "PERSONA_REACTIVADA",
      activa: true,
      revocaSesiones: false,
    },
    (persona) => {
      const r = decidirReactivacionDePersona(persona);
      return r.ok ? ok({ motivo: null }) : r;
    },
    () => null,
  );

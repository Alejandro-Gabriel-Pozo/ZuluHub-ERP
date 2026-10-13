import type { ContextoDeInvitacion } from "../../../contexto/contexto";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { cambiarEstado as cambiarEstadoDeEmpresa } from "../../empresas/publico";
import { emailDesdeTexto, type Email } from "../../../primitivas/contacto/email";
import type { ErrorDeAceptacion } from "../dominio/errores";
import { decidirAceptacion, type Invitacion, type RolDeEmpresa } from "../dominio/invitacion";
import type { Persona } from "../dominio/membresia";
import { cargarEmpresas } from "./comun";
import type { DependenciasDeIdentidad, TxDeIdentidad } from "./contrato";
import { traducirErrores } from "./traducir";

export type EntradaDeAceptacion = Readonly<{
  /** El token del enlace, en claro: solo se usa para calcular su hash; no se guarda ni se registra. */
  token: string;
  /** El email con el que la persona se autenticó; `null` si no hay sesión verificada. */
  emailAutenticado: string | null;
  ahora: Date;
}>;

export type SalidaDeAceptacion = Readonly<{
  /** `true`: la invitación ya estaba aceptada por esta persona; no se escribió nada. */
  yaEstabaAceptada: boolean;
  personaId: PersonaId;
  empresas: readonly Readonly<{ empresaId: EmpresaId; rol: RolDeEmpresa }>[];
}>;

export type ErrorAlAceptarInvitacion = ErrorDeAceptacion | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso. */
const RESTRICCIONES_ADMITIDAS = [
  "YA_ES_MIEMBRO",
  "INVITACION_DE_OTRO_EMAIL",
  "INVITACION_VENCIDA",
  "INVITACION_NO_PENDIENTE",
] as const;

const resumen = (i: Invitacion): SalidaDeAceptacion["empresas"] =>
  i.empresas.map((e) => ({ empresaId: e.empresaId, rol: e.rol }));

function emailAutenticadoNormalizado(texto: string | null): Email | null {
  if (texto === null) return null;
  const r = emailDesdeTexto(texto);
  return r.ok ? r.valor : null;
}

/**
 * Aceptar una invitación (diseño §6.3). Contexto de INVITACION (rol de la aplicación, solo el hash
 * del token). Todo o nada, en UNA transacción serializable:
 *
 *  1. Lee la invitación por el hash del token, las empresas y los estados, y la persona del email.
 *  2. Decide con el dominio (`decidirAceptacion`). Una invitación ya aceptada por esta persona vuelve
 *     `ok { yaEstabaAceptada: true }` sin escribir, siempre que el email autenticado coincida.
 *  3. Crea la persona si falta (el invitado solo puede crear la de SU email).
 *  4. `PENDIENTE → ACEPTADA` (condicionada por estado y versión).
 *  5. Recién ahora el invitado ve sus membresías: vuelve a decidir con ellas (`YA_ES_MIEMBRO`,
 *     `ROL_DISTINTO_AL_ANTERIOR`). Si falla, la transacción se revierte entera, aceptación incluida.
 *  6. Crea o reactiva la membresía y las asignaciones de TODAS las empresas.
 *  7. Si es el alta del gerente, activa la empresa (`PROVISIONING → ACTIVE`).
 *  8. Auditoría por empresa, a nombre de la persona, sin token ni hash.
 */
export function crearAceptarInvitacion({ transacciones, tokens }: DependenciasDeIdentidad) {
  return async function aceptarInvitacion(
    entrada: EntradaDeAceptacion,
  ): Promise<Resultado<SalidaDeAceptacion, ErrorAlAceptarInvitacion>> {
    const { ahora } = entrada;
    const tokenHash = tokens.hash(entrada.token);
    const emailAutenticado = emailAutenticadoNormalizado(entrada.emailAutenticado);
    const contexto: ContextoDeInvitacion = { tipo: "INVITACION", tokenHash, ahora };

    const resultado = await transacciones.ejecutar(
      { contexto },
      async (tx): Promise<Resultado<SalidaDeAceptacion, ErrorDeAceptacion>> => {
        const invitacion = await tx.invitaciones.obtenerPorHash(tokenHash);
        if (invitacion === null) return err("INVITACION_NO_ENCONTRADA");

        const empresaIds = invitacion.empresas.map((e) => e.empresaId);
        const { empresas, estados } = await cargarEmpresas(tx, empresaIds);
        const personaExistente = await tx.personas.buscarPorEmail(invitacion.email);
        const sinMembresias = {
          ahora,
          emailAutenticado,
          estados,
          miembroActivoEn: new Set<EmpresaId>(),
          rolesAnteriores: new Map<EmpresaId, RolDeEmpresa>(),
        };

        const primera = decidirAceptacion(invitacion, {
          ...sinMembresias,
          persona: personaExistente,
        });
        if (!primera.ok) return primera;
        if (primera.valor.tipo === "YA_ACEPTADA") {
          // La repetición solo se reconoce a quien se autentica con el email de la invitación.
          if (emailAutenticado !== invitacion.email) return err("INVITACION_DE_OTRO_EMAIL");
          if (personaExistente === null) {
            throw new Error("invariante rota: invitación aceptada por una persona que no existe");
          }
          return ok({
            yaEstabaAceptada: true,
            personaId: personaExistente.id,
            empresas: resumen(invitacion),
          });
        }

        const persona: Persona = personaExistente ?? (await tx.personas.crear(invitacion.email));
        if (
          !(await tx.invitaciones.marcarAceptada(
            invitacion.id,
            invitacion.version,
            persona.id,
            ahora,
          ))
        ) {
          return err("INVITACION_NO_PENDIENTE");
        }

        // Desde acá el invitado ve sus membresías y asignaciones (política D10 de la migración 0002).
        const existentes = await tx.membresias.deLaPersonaEn(persona.id, empresaIds);
        const segunda = decidirAceptacion(invitacion, {
          ...sinMembresias,
          persona,
          miembroActivoEn: new Set(existentes.filter((m) => m.activo).map((m) => m.empresaId)),
          rolesAnteriores: new Map(
            existentes.filter((m) => !m.activo).map((m) => [m.empresaId, m.rol] as const),
          ),
        });
        if (!segunda.ok) return segunda;

        for (const invitada of invitacion.empresas) {
          const previa = existentes.find((m) => m.empresaId === invitada.empresaId);
          if (previa === undefined) {
            await tx.membresias.crear({
              empresaId: invitada.empresaId,
              personaId: persona.id,
              rol: invitada.rol,
              invitacionId: invitacion.id,
            });
          } else if (
            !(await tx.membresias.reactivar(invitada.empresaId, persona.id, previa.version))
          ) {
            return err("INVITACION_NO_PENDIENTE");
          }
          await asignarSucursales(tx, invitada.empresaId, persona.id, invitada.sucursales);
        }

        const activadas: EmpresaId[] = [];
        if (invitacion.tipo === "ALTA_GERENTE") {
          for (const { empresaId } of invitacion.empresas) {
            const empresa = empresas.get(empresaId);
            if (empresa === undefined) throw new Error(`falta la empresa ${empresaId}`);
            const cambio = cambiarEstadoDeEmpresa(empresa, "ACTIVE", null);
            // El dominio ya comprobó que está en PROVISIONING: una transición no permitida es un defecto.
            if (!cambio.ok) throw new Error(`no se puede activar la empresa ${empresaId}`);
            const activada = await tx.empresas.cambiarEstado(
              empresaId,
              empresa.version,
              cambio.valor,
            );
            if (!activada.ok) return err("ALTA_NO_PENDIENTE");
            activadas.push(empresaId);
          }
        }

        for (const invitada of invitacion.empresas) {
          const reactivada = existentes.some((m) => m.empresaId === invitada.empresaId);
          await tx.auditoria.registrar({
            empresaId: invitada.empresaId,
            actorPersonaId: persona.id,
            accion: invitacion.tipo === "ALTA_GERENTE" ? "ALTA_ACEPTADA" : "INVITACION_ACEPTADA",
            entidad: "invitacion",
            entidadId: invitacion.id,
            antes: { estado: "PENDIENTE" },
            despues: {
              estado: "ACEPTADA",
              rol: invitada.rol,
              reactivada,
              sucursales: invitada.sucursales,
            },
          });
          if (activadas.includes(invitada.empresaId)) {
            await tx.auditoria.registrar({
              empresaId: invitada.empresaId,
              actorPersonaId: persona.id,
              accion: "EMPRESA_ACTIVADA",
              entidad: "empresa",
              entidadId: invitada.empresaId,
              antes: { estado: "PROVISIONING" },
              despues: { estado: "ACTIVE" },
            });
          }
        }
        return ok({
          yaEstabaAceptada: false,
          personaId: persona.id,
          empresas: resumen(invitacion),
        });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}

/** Crea las asignaciones que faltan y reactiva las apagadas; las que ya están activas no se tocan. */
async function asignarSucursales(
  tx: TxDeIdentidad,
  empresa: EmpresaId,
  persona: PersonaId,
  sucursales: Invitacion["empresas"][number]["sucursales"],
): Promise<void> {
  if (sucursales.length === 0) return;
  const actuales = await tx.asignaciones.deLaPersona(empresa, persona);
  const faltan = sucursales.filter((s) => !actuales.some((a) => a.sucursalId === s));
  await tx.asignaciones.crear(empresa, persona, faltan);
  for (const apagada of actuales.filter((a) => !a.activa && sucursales.includes(a.sucursalId))) {
    await tx.asignaciones.reactivar(empresa, persona, apagada.sucursalId, apagada.version);
  }
}

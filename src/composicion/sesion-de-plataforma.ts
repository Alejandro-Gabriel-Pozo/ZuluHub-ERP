import {
  decidirAccesoDelAdministrador,
  decidirSesionDeLaConsola,
} from "../capacidades/autenticacion/acceso-a-la-consola";
import type { CodigoDePlataforma } from "../capacidades/autenticacion/codigos-de-plataforma";
import type { ContextoDePlataforma } from "../contexto/contexto";
import type { AdminPlataformaId } from "../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import type { AdminEncontrado } from "../puertos/admins-de-plataforma";
import type { SesionAutenticada } from "../puertos/autenticacion";
import type { RolDeAdministrador } from "../puertos/autorizacion-de-plataforma";
import { contextoDePlataforma } from "./contextos";

/**
 * De la sesión de la consola al `ContextoDePlataforma` (h5-p8 §2.3): `contextoDePlataformaDeLaSesion`. Es el ÚNICO camino
 * que arma el contexto de plataforma de una persona con sesión (los scripts del dueño, que no tienen sesión web, arman el
 * suyo en `scripts/` identificando al administrador por su email).
 *
 * Exige TODO junto, en este orden, y recién entonces arma el contexto (claim `a` = id del administrador, que lo firma el
 * adaptador de transacciones en cada intento):
 *  1. la sesión vale en el host de la consola con los límites de plataforma (8 horas / 30 minutos) y trae el email
 *     verificado;
 *  2. el email es el de un administrador ACTIVO de `admin_plataforma`, leído de la base en este pedido (el rol que
 *     informa es el de la base: del navegador no viaja nada);
 *  3. el segundo factor está verificado EN ESTA SESIÓN (G1).
 * Si falta algo, devuelve uno de los 7 códigos públicos de la consola (`codigos-de-plataforma.ts`): nunca un contexto
 * parcial y nunca una excepción. Ante un fallo de la lectura (la base caída, un entorno mal configurado) el pedido se
 * rechaza con `no_habilitado`, igual que el ingreso: nada deja entrar por un error. El detalle va al registro del
 * servidor, solo con el nombre del error.
 *
 * Esto NO es el chequeo del segundo factor RECIENTE de cada acción: ese lo hace la puerta de la consola antes de correr
 * cada caso (`puerta-de-consola.ts`), con la marca `segundoFactorReciente` del catálogo.
 */

export type DependenciasDeSesionDePlataforma = Readonly<{
  /** El host de la consola (por ejemplo, el dominio del proyecto `apps/plataforma`). Una sesión de otro host no entra. */
  hostDeLaConsola: string;
  /** Lee al administrador por su email, con el actor `sistema` y en solo lectura (`Plataforma.buscarAdmin`). */
  buscarAdmin: (email: string, ahora: Date) => Promise<AdminEncontrado | null>;
  reloj: () => Date;
  /** Registro del servidor: recibe un texto SIN datos de la persona. */
  registrar?: ((detalle: string) => void) | undefined;
}>;

export type AccesoDeSesionDePlataforma = Readonly<{
  /** El contexto de plataforma del administrador (todavía sin firmar) con la hora de este pedido. */
  contexto: ContextoDePlataforma;
  admin: Readonly<{ id: AdminPlataformaId; rol: RolDeAdministrador }>;
  /** Cuándo se verificó el segundo factor de esta sesión. */
  segundoFactorEn: Date;
  /** Lo que le queda a la ventana de 5 minutos del segundo factor, o 0. */
  segundoFactorRecienteHastaMs: number;
  /** La hora de este pedido (se toma una sola vez, regla G4). */
  ahora: Date;
}>;

export function crearContextoDePlataformaDeLaSesion(
  dependencias: DependenciasDeSesionDePlataforma,
) {
  const registrar = dependencias.registrar ?? (() => undefined);

  return async function contextoDePlataformaDeLaSesion(
    sesion: SesionAutenticada | null,
  ): Promise<Resultado<AccesoDeSesionDePlataforma, CodigoDePlataforma>> {
    if (sesion === null) return err("sesion_vencida");
    const ahora = dependencias.reloj();

    const vigente = decidirSesionDeLaConsola(sesion, dependencias.hostDeLaConsola, ahora);
    if (!vigente.ok) return vigente;

    let admin: AdminEncontrado | null;
    try {
      admin = await dependencias.buscarAdmin(sesion.email, ahora);
    } catch (falla) {
      try {
        registrar(
          `[consola] no se pudo leer al administrador: ${falla instanceof Error ? falla.name : "error"}`,
        );
      } catch {
        // Un registro que falla no puede tapar el rechazo.
      }
      return err("no_habilitado");
    }

    const acceso = decidirAccesoDelAdministrador(sesion, admin, ahora);
    if (!acceso.ok) return acceso;
    return ok({
      contexto: contextoDePlataforma({ actor: { tipo: "ADMIN", id: acceso.valor.adminId }, ahora }),
      admin: { id: acceso.valor.adminId, rol: acceso.valor.rol },
      segundoFactorEn: acceso.valor.segundoFactorEn,
      segundoFactorRecienteHastaMs: acceso.valor.segundoFactorRecienteHastaMs,
      ahora,
    });
  };
}

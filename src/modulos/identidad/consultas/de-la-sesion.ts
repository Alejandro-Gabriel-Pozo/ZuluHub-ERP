import type { RolDeEmpresa } from "../../../capacidades/permisos/roles";
import type { ContextoDeSesion } from "../../../contexto/contexto";
import {
  estadoEfectivo,
  type EstadoDeEmpresa,
  type EstadoEfectivo,
} from "../../../contexto/estados";
import type {
  EmpresaId,
  MarcaComercialId,
  PersonaId,
} from "../../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { LecturasDeSesion } from "../../../puertos/sesion";
import type { ErrorDePersistencia, Transacciones } from "../../../puertos/transacciones";
import { comparar } from "./orden";

/**
 * Las consultas de quien ya ingresó y todavía no eligió empresa (web-armazon §3.3, §4.6). Corren con el
 * contexto `SESION` (claim firmado `s`): la base deja leer solo lo del usuario de la sesión. NO piden
 * acción al guard: el guard autoriza a una persona EN una empresa, y acá todavía no hay empresa; lo que
 * acota es la base (RLS), y la marca la acota la consulta. Solo lectura, por tipos y por la transacción.
 */
export type TxDeConsultasDeSesion = Readonly<{ sesion: LecturasDeSesion }>;

export type DependenciasDeConsultasDeSesion = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeSesion>;
}>;

/** Una empresa de la lista «elegir empresa» (objeto plano, sin texto de marca: ADR-005). */
export type EmpresaDeLaLista = Readonly<{
  empresaId: EmpresaId;
  nombre: string;
  rol: RolDeEmpresa;
  /** El estado de la propia empresa. */
  estado: EstadoDeEmpresa;
  /** El estado efectivo (empresa y tenant juntos): `OPERA` o por qué no (un tenant suspendido, por ejemplo). */
  estadoEfectivo: EstadoEfectivo;
}>;

export type EntradaDeEmpresasDeLaSesion = Readonly<{
  /** La marca de la puerta por la que se entró: la que resolvió el servidor desde el host. */
  marcaId: MarcaComercialId;
}>;

export function crearConsultasDeSesion({ transacciones }: DependenciasDeConsultasDeSesion) {
  const lectura = { aislamiento: "read committed", soloLectura: true } as const;
  return {
    /**
     * La persona activa vinculada con el usuario de la sesión, o `null` si no hay (nunca se busca por
     * email: el vínculo lo fija la aceptación de una invitación).
     */
    async personaDeLaSesion(
      contexto: ContextoDeSesion,
    ): Promise<Resultado<Readonly<{ personaId: PersonaId }> | null, ErrorDePersistencia>> {
      return transacciones.ejecutar({ contexto, ...lectura }, async (tx) => {
        const persona = await tx.sesion.personaDelUsuario(contexto.usuarioAuth);
        return ok(persona === null ? null : { personaId: persona });
      });
    },

    /**
     * Las empresas de la persona de la sesión (membresía activa) en la marca de la puerta, ordenadas por
     * nombre y empresa. Lista todas las que tenga, operen o no: la pantalla muestra por qué no se puede
     * entrar a una suspendida. Sin vínculo, o con otra marca, la lista es vacía.
     */
    async empresasDeLaSesion(
      contexto: ContextoDeSesion,
      entrada: EntradaDeEmpresasDeLaSesion,
    ): Promise<Resultado<readonly EmpresaDeLaLista[], ErrorDePersistencia>> {
      return transacciones.ejecutar({ contexto, ...lectura }, async (tx) => {
        const empresas = await tx.sesion.empresasDelUsuario(contexto.usuarioAuth, entrada.marcaId);
        return ok(
          empresas
            .map((e): EmpresaDeLaLista => ({
              empresaId: e.empresaId,
              nombre: e.nombre,
              rol: e.rol,
              estado: e.estado,
              estadoEfectivo: estadoEfectivo(e.estadoDelTenant, e.estado),
            }))
            .sort((a, b) => comparar(a.nombre, b.nombre) || comparar(a.empresaId, b.empresaId)),
        );
      });
    },
  };
}

export type ConsultasDeSesion = ReturnType<typeof crearConsultasDeSesion>;

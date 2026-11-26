import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import { exigirPerilla, type ErrorDePerilla } from "../../../capacidades/planes/derechos";
import { accionesIniciales } from "../../../capacidades/roles/acciones-iniciales";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { claveDeNombreDeRol, nombreDeRolDesdeTexto } from "../../../primitivas/texto/nombre-de-rol";
import type { MotivoDeTextoInvalido } from "../../../primitivas/texto/texto-de-una-linea";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  decidirAltaDeRol,
  decidirTopeTecnicoDeRoles,
  type ErrorDeRolPropio,
} from "../dominio/rol-propio";
import type { PlantillaDeOrigen } from "../persistencia/repositorios";
import type { DependenciasDeIdentidad } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import {
  conjuntoValido,
  moduloDeLaAccionDe,
  permisoYEmpresaQueOpera,
  type ConjuntoDeAccionesInvalido,
} from "./roles-comun";
import { traducirErrores } from "./traducir";

/** De dónde nace el rol: de cero (solo con lo obligatorio), copiando una plantilla base o copiando otro rol de la empresa. Desde ahí es independiente (S9). */
export type OrigenDeUnRol =
  | Readonly<{ tipo: "VACIO" }>
  | Readonly<{ tipo: "PLANTILLA"; clave: PlantillaDeOrigen }>
  | Readonly<{ tipo: "ROL"; rolId: string }>;

export type EntradaDeCrearRol = Readonly<{
  /** Lo manda quien llama (la pantalla lo genera al abrir el formulario): es la idempotencia del alta. */
  rolId: string;
  nombre: string;
  origen: OrigenDeUnRol;
}>;

export type SalidaDeCrearRol = Readonly<{
  rolId: string;
  /** `true`: ya estaba (el mismo pedido repetido, o un rol activo con ese nombre); no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropio =
  | ErrorDeRolPropio
  | "NOMBRE_DE_ROL_INVALIDO"
  | "ORIGEN_DE_ROL_NO_ENCONTRADO"
  | ConjuntoDeAccionesInvalido
  | ErrorDePerilla;

export type ErrorAlCrearRol = ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el dominio). */
const RESTRICCIONES_ADMITIDAS = [
  "NOMBRE_DE_ROL_INVALIDO",
  "NOMBRE_DE_ROL_EN_USO",
  "ID_DE_ROL_EN_USO",
] as const;

/** El texto del nombre que la base y el dominio aceptan, o el motivo (el motivo del texto no se expone: es un solo error con nombre). */
const nombreValido = (texto: string): Resultado<string, "NOMBRE_DE_ROL_INVALIDO"> => {
  const nombre: Resultado<string, MotivoDeTextoInvalido> = nombreDeRolDesdeTexto(texto);
  return nombre.ok ? ok(nombre.valor) : err("NOMBRE_DE_ROL_INVALIDO");
};

/**
 * Crear un rol propio en la empresa del contexto (H4b T4). Solo el gerente (`roles.crear`). En una transacción serializable: guard, la empresa opera, nombre válido, y entonces:
 *  - ya hay un rol con ese id (el mismo pedido repetido) o un rol ACTIVO con ese nombre (sin distinguir mayúsculas) → `yaExistia: true` sin escribir ni auditar; con el id de otro
 *    nombre → `ID_DE_ROL_EN_USO`; con el nombre de un rol archivado → `ROL_INACTIVO_CON_ESE_NOMBRE` (se lo reactiva);
 *  - la perilla del plan (`roles_propios_por_empresa`, sin límite de base) y el tope técnico de 100 roles activos, contados en esta transacción (dos altas a la vez no pasan las dos);
 *  - el conjunto inicial sale del origen (de cero: solo los pisos «todos los roles»; copiando una plantilla u otro rol: lo que el plan y los pisos permiten de esa copia) y se valida
 *    igual que una edición; se inserta el rol con su versión 1 y se audita `ROL_CREADO`, todo en la misma transacción.
 */
export function crearCrearRol({ transacciones, reglas }: DependenciasDeIdentidad) {
  return async function crearRol(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearRol,
  ): Promise<Resultado<SalidaDeCrearRol, ErrorAlCrearRol>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<Resultado<SalidaDeCrearRol, ErrorPropio | MotivoDeRechazo | EmpresaNoOpera>> => {
        const previo = await permisoYEmpresaQueOpera(
          tx,
          contexto,
          reglas,
          DECLARACIONES.crearRol.accion,
        );
        if (!previo.ok) return previo;
        const nombre = nombreValido(entrada.nombre);
        if (!nombre.ok) return nombre;
        const nombreClave = claveDeNombreDeRol(nombre.valor);

        const decision = decidirAltaDeRol({
          nombreClave,
          porId: await tx.roles.obtener(empresaId, entrada.rolId),
          porNombre: await tx.roles.obtenerPorNombre(empresaId, nombreClave),
        });
        if (!decision.ok) return decision;
        if (decision.valor.tipo === "YA_EXISTIA") {
          return ok({ rolId: decision.valor.rolId, yaExistia: true });
        }

        const derechos = await tx.derechos.deLaEmpresa(contexto);
        const enUso = await tx.roles.contarActivos(empresaId);
        const perilla = exigirPerilla(derechos, "roles_propios_por_empresa", { empresaId }, enUso);
        if (!perilla.ok) return perilla;
        const tope = decidirTopeTecnicoDeRoles(enUso);
        if (!tope.ok) return tope;

        const pisos = await tx.roles.pisos();
        let copia: readonly string[] = [];
        let plantillaOrigen: PlantillaDeOrigen | null = null;
        if (entrada.origen.tipo === "PLANTILLA") {
          copia = (await tx.roles.accionesDeLaPlantilla(entrada.origen.clave)) ?? [];
          plantillaOrigen = entrada.origen.clave;
        } else if (entrada.origen.tipo === "ROL") {
          const deOrigen = await tx.roles.obtener(empresaId, entrada.origen.rolId);
          if (deOrigen === null) return err("ORIGEN_DE_ROL_NO_ENCONTRADO");
          copia = deOrigen.acciones;
          plantillaOrigen = deOrigen.plantillaOrigen;
        }
        const iniciales = accionesIniciales(copia, {
          moduloDeLaAccion: moduloDeLaAccionDe(reglas),
          modulosDelPlan: derechos.modulosHabilitados,
          pisos,
        });
        const acciones = conjuntoValido(iniciales, reglas, derechos.modulosHabilitados, pisos);
        if (!acciones.ok) return acciones;
        if (contexto.personaId === null) {
          throw new Error("invariante rota: el guard dejó pasar un contexto sin persona");
        }

        await tx.roles.crear({
          id: entrada.rolId,
          empresaId,
          nombre: nombre.valor,
          nombreClave,
          plantillaOrigen,
          acciones: acciones.valor,
          creadoPor: contexto.personaId,
          ahora: contexto.ahora,
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "ROL_CREADO",
          entidad: "rol_de_empresa",
          entidadId: entrada.rolId,
          despues: {
            nombre: nombre.valor,
            plantillaOrigen,
            origen: entrada.origen.tipo,
            acciones: acciones.valor,
          },
        });
        return ok({ rolId: entrada.rolId, yaExistia: false });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}

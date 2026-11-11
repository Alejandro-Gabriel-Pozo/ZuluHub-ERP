import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esNivelDeCompra, PERILLA_DEL_NIVEL, type NivelDeCompra } from "../dominio/niveles";
import { autorizar, traducir } from "./comun";
import type { DependenciasDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";

type R<S> = Resultado<S, ErrorDeCompras>;

export type EntradaDeConfigurarCompras = Readonly<{ nivel: string; versionEsperada: number }>;
export type SalidaDeConfigurarCompras = Readonly<{ nivel: NivelDeCompra; version: number }>;

/**
 * Cambiar el nivel de operación de las compras (E9 §3.3): lo hace el gerente (`compras.configurar`) y rige HACIA ADELANTE (cada compra sella el nivel con que
 * nació; nada de lo cargado se toca). N3 y N4 son extras de pago apagados por perilla (P-4): hasta que existan sus perillas, pedirlos es `FUNCION_NO_INCLUIDA`
 * con el nombre de la perilla. Repetición (`SIN_CAMBIOS`): pedir el nivel que ya está devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni
 * auditar; con otro nivel y versión vieja, `VERSION_DESACTUALIZADA`.
 */
export function armarConfigurarCompras(dependencias: DependenciasDeCompras) {
  return async function configurarCompras(
    contexto: ContextoOperativo,
    entrada: EntradaDeConfigurarCompras,
  ): Promise<R<SalidaDeConfigurarCompras>> {
    const { empresaId } = contexto;
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeConfigurarCompras>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "compras.configurar",
          ]);
          if (!permiso.ok) return permiso;
          if (!esNivelDeCompra(entrada.nivel)) return err("NIVEL_INVALIDO");
          const perilla = PERILLA_DEL_NIVEL[entrada.nivel];
          if (perilla !== null) return err({ error: "FUNCION_NO_INCLUIDA", perilla });
          const actual = await tx.configuracionDeCompras.bloquear(empresaId);
          if (actual.nivel === entrada.nivel) return ok(actual);
          if (actual.version !== entrada.versionEsperada) return err("VERSION_DESACTUALIZADA");
          const nueva = await tx.configuracionDeCompras.cambiarNivel(
            empresaId,
            entrada.nivel,
            actual.version,
          );
          if (nueva === null) return err("VERSION_DESACTUALIZADA");
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: contexto.personaId,
            accion: "COMPRAS_NIVEL_CAMBIADO",
            entidad: "configuracion_de_compras",
            entidadId: empresaId,
            antes: { nivel: actual.nivel },
            despues: { nivel: nueva.nivel },
          });
          return ok(nueva);
        },
      ),
    );
  };
}

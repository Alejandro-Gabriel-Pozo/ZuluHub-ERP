import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  agregarElMedioDePago,
  desactivarElMedioDePago,
  editarElMedioDePago,
  listarLosMediosDePago,
  reactivarElMedioDePago,
  type DependenciasDeMediosDePagoWeb,
  type MediosParaLaPantalla,
} from "../../../src/composicion/medios-de-pago-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { RUTAS_DE_MEDIOS } from "../ui/plantillas/caja/modelo-de-medios-de-pago";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./facturacion";
import { aLaLista, textoDe } from "./formularios-de-caja";
import { dependenciasDeSesion } from "./sesion";

/**
 * «Medios de pago» de la configuración de caja: la lectura de la lista y las acciones de agregar, editar el nombre, desactivar y reactivar. Finas a
 * propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa (`conLaEmpresa`: sesión, origen propio y empresa elegida, nunca los que diga el
 * navegador) y llaman a `src/composicion/medios-de-pago-web.ts`, donde se prueba el resto. El permiso (`cajas.ver` / `medios_de_pago.*`) y la validez del
 * nombre y del tipo los decide el servidor, dentro de la transacción: la pantalla no valida nada. Del formulario solo se toman los campos que la acción
 * declara; el id y la versión no viajan en el formulario: los fija la página al armar la acción (`bind`). Cómo se repite sin duplicar: agregar lo que ya existe
 * devuelve lo existente; desactivar y reactivar no escriben si ya estaba así; editar lleva la versión.
 */

const dependencias: DependenciasDeMediosDePagoWeb = {
  casosDeUso: web.casosDeUsoDeCaja,
  consultas: web.consultasDeCaja,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Todos los medios de la empresa (también los desactivados), con el contexto que ya resolvió la página. */
export function cargarLosMedios(
  contexto: ContextoOperativo,
): Promise<Respuesta<MediosParaLaPantalla>> {
  return listarLosMediosDePago(dependencias, contexto);
}

export async function agregarElMedio(datos: FormData): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      agregarElMedioDePago(dependencias, contexto, {
        tipo: textoDe(datos, "tipo"),
        nombre: textoDe(datos, "nombre"),
      }),
    ),
    RUTAS_DE_MEDIOS.lista,
  );
}

export async function editarElMedio(
  medioDePagoId: string,
  versionEsperada: number,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      editarElMedioDePago(dependencias, contexto, {
        medioDePagoId,
        versionEsperada,
        nombre: textoDe(datos, "nombre"),
      }),
    ),
    RUTAS_DE_MEDIOS.lista,
  );
}

export async function desactivarElMedio(medioDePagoId: string): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      desactivarElMedioDePago(dependencias, contexto, { medioDePagoId }),
    ),
    RUTAS_DE_MEDIOS.lista,
  );
}

export async function reactivarElMedio(medioDePagoId: string): Promise<ResultadoDeAccion> {
  return aLaLista(
    await conLaEmpresa((contexto) =>
      reactivarElMedioDePago(dependencias, contexto, { medioDePagoId }),
    ),
    RUTAS_DE_MEDIOS.lista,
  );
}

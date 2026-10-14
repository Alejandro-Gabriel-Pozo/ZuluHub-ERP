import { redirect } from "next/navigation";
import type { ErrorPublico } from "../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../src/capacidades/vocabulario/vocabulario";
import { EnlaceDeAccion } from "../ui/componentes/EnlaceDeAccion";
import { ErrorDeRespuesta } from "../ui/patrones/ErrorDeRespuesta";
import { PantallaDeEstado } from "../ui/plantillas/sesion/PantallaDeEstado";

/**
 * Qué se ve cuando no se pudo saber a qué empresa entra la persona (capa 6, pantallas). Cada código del
 * traductor único tiene su pantalla: sin permiso («por qué no puedo» + cambiar de empresa), mantenimiento,
 * sesión vencida (a ingresar) y lo inesperado (con su referencia y «Reintentar»).
 */
export function PantallaDeErrorDeEntrada({ error }: Readonly<{ error: ErrorPublico }>) {
  if (error.codigo === "SESION_VENCIDA") redirect("/ingreso");
  if (error.codigo === "NO_DISPONIBLE") {
    return (
      <PantallaDeEstado
        titulo={texto({}, "estado.mantenimiento_titulo")}
        detalle={texto({}, "estado.mantenimiento_detalle")}
      >
        <ErrorDeRespuesta
          error={error}
          accion={<EnlaceDeAccion href="/">{texto({}, "estado.reintentar")}</EnlaceDeAccion>}
        />
      </PantallaDeEstado>
    );
  }
  if (error.presentacion === "POR_QUE_NO_PUEDO") {
    return (
      <PantallaDeEstado titulo={texto({}, "estado.sin_permiso_titulo")}>
        <ErrorDeRespuesta
          error={error}
          accion={<EnlaceDeAccion href="/empresa">{texto({}, "empresa.cambiar")}</EnlaceDeAccion>}
        />
      </PantallaDeEstado>
    );
  }
  return (
    <PantallaDeEstado titulo={texto({}, "estado.error_titulo")}>
      <ErrorDeRespuesta
        error={error}
        accion={<EnlaceDeAccion href="/">{texto({}, "estado.reintentar")}</EnlaceDeAccion>}
      />
    </PantallaDeEstado>
  );
}

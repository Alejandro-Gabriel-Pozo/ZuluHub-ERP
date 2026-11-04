import { PantallaDeInicio } from "../../../../ui/plantillas/sesion/PantallaDeInicio";
import { pantallaDeOperacion } from "../../../../pantallas/operacion";
import { pendientesDeLaEmpresa } from "../../../../servidor/modulos";

// Inicio: dónde estás y la ranura «lo que falta» (hoy: completar la configuración fiscal; la llenan los módulos).
export default function PaginaDeInicio() {
  return pantallaDeOperacion(
    { titulo: "inicio.titulo", actual: "inicio" },
    async ({ empresa, contexto }) => (
      <PantallaDeInicio empresa={empresa} pendientes={await pendientesDeLaEmpresa(contexto)} />
    ),
  );
}

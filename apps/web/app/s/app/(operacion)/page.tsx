import { PantallaDeInicio } from "../../../../ui/plantillas/sesion/PantallaDeInicio";
import { pantallaDeOperacion } from "../../../../pantallas/operacion";
import { pendientesDeLaEmpresa } from "../../../../servidor/modulos";

// Inicio: dónde estás y la ranura «lo que falta» (vacía en v1: la llenan los módulos).
export default function PaginaDeInicio() {
  return pantallaDeOperacion({ titulo: "inicio.titulo", actual: "inicio" }, ({ empresa }) => (
    <PantallaDeInicio empresa={empresa} pendientes={pendientesDeLaEmpresa()} />
  ));
}

import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { armarElFormularioDeAltaDeSucursal } from "../../../../../../../ui/plantillas/sucursales/modelo-de-sucursales";
import { FormularioDeAltaDeSucursal } from "../../../../../../../ui/plantillas/sucursales/FormularioDeAltaDeSucursal.cliente";
import { RUTAS_DE_CUENTA } from "../../../../../../../ui/plantillas/sesion/rutas-de-cuenta";
import { crearSucursalAccion } from "../../../../acciones-de-sucursales";

// `/cuenta/sucursales/nueva`: el formulario de alta (solo el nombre). Repetir el envío con el mismo nombre (doble toque, reintento) devuelve la sucursal que ya había y nunca crea dos; qué puede crear la persona lo decide el
// servidor al enviar.
export default async function PaginaDeNuevaSucursal() {
  return pantallaDeOperacion({ titulo: "usuarios.campo.sucursales" }, () =>
    conTitulo(
      texto({}, "sucursales.lista.nueva"),
      <FormularioDeAltaDeSucursal
        formulario={armarElFormularioDeAltaDeSucursal({})}
        accion={crearSucursalAccion}
        rutaDeLaLista={RUTAS_DE_CUENTA.sucursales}
      />,
    ),
  );
}

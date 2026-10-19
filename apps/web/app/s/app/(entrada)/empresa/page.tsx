import { redirect } from "next/navigation";
import { PantallaDeEleccionDeEmpresa } from "../../../../../ui/plantillas/sesion/PantallaDeEleccionDeEmpresa";
import { PantallaSinEmpresas } from "../../../../../ui/plantillas/sesion/PantallaSinEmpresas";
import { PantallaDeErrorDeEntrada } from "../../../../../pantallas/errores";
import { empresasDelPedido } from "../../../../../servidor/empresas";
import { cerrarSesionAccion, entrarALaEmpresaAccion } from "../../acciones";

// `/empresa`: elegir (o cambiar) la empresa. Lista SOLO las de la persona en la marca de este host. Sin ninguna:
// «No tenés empresas en {marca}. Si te invitaron, abrí el enlace del mail» (nunca se busca por email).
export default async function PaginaDeEleccionDeEmpresa() {
  const { puerta, empresas } = await empresasDelPedido();
  if (!empresas.ok) {
    if (empresas.error.codigo === "SESION_VENCIDA") redirect("/ingreso");
    return <PantallaDeErrorDeEntrada error={empresas.error} />;
  }
  if (empresas.dato.empresas.length === 0) {
    return (
      <PantallaSinEmpresas marca={puerta.marca.nombre} accionDeCerrarSesion={cerrarSesionAccion} />
    );
  }
  return (
    <PantallaDeEleccionDeEmpresa
      empresas={empresas.dato.empresas}
      accion={entrarALaEmpresaAccion}
    />
  );
}

import { PantallaDeInicio } from "../../../../ui/plantillas/sesion/PantallaDeInicio";
import { redirect } from "next/navigation";
import { pantallaDeOperacion } from "../../../../pantallas/operacion";
import { debeElegirSucursal } from "../../../../pantallas/puerta-de-sucursal";
import { pendientesDeLaEmpresa } from "../../../../servidor/modulos";
import { sucursalDelPedido } from "../../../../servidor/sucursal-elegida";

// Inicio: dónde estás y la ranura «lo que falta» (hoy: completar la configuración fiscal; la llenan los módulos).
export default function PaginaDeInicio() {
  return pantallaDeOperacion(
    { titulo: "inicio.titulo", actual: "inicio" },
    async ({ empresa, contexto }) => {
      // «Elegir sucursal» al ingresar: sin sucursal efectiva se pasa por la pantalla. Con error de la consulta, se sigue como siempre.
      const sucursales = await sucursalDelPedido(contexto);
      if (
        sucursales.ok &&
        debeElegirSucursal(sucursales.dato.elegibles.length, sucursales.dato.efectiva)
      ) {
        redirect("/sucursal");
      }
      return (
        <PantallaDeInicio empresa={empresa} pendientes={await pendientesDeLaEmpresa(contexto)} />
      );
    },
  );
}

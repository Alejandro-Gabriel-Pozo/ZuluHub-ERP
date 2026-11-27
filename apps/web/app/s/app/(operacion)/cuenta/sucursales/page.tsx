import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import {
  cargarLasSucursales,
  ofertaDeCrearSucursales,
} from "../../../../../../servidor/sucursales";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { armarLaListaDeSucursales } from "../../../../../../ui/plantillas/sucursales/modelo-de-sucursales";
import { PantallaDeListaDeSucursales } from "../../../../../../ui/plantillas/sucursales/PantallaDeListaDeSucursales";

// `/cuenta/sucursales`: las sucursales activas de la empresa. Abrirlo solo lee. La empresa y la persona salen de la sesión; el permiso (`sucursales.ver`) lo decide el servidor dentro de la consulta. Sin permiso o con una
// falla sale el mensaje genérico del catálogo, sin filas ni botones. «Nueva sucursal» se ofrece solo a quien puede crear; el servidor lo vuelve a exigir.
export default async function PaginaDeSucursales() {
  return pantallaDeOperacion({ titulo: "usuarios.campo.sucursales" }, async ({ contexto }) => {
    const sucursales = await cargarLasSucursales(contexto);
    if (!sucursales.ok) return <ErrorDelDetalle error={sucursales.error} />;
    const puedeCrear = await ofertaDeCrearSucursales(contexto);
    return (
      <PantallaDeListaDeSucursales
        lista={armarLaListaDeSucursales(sucursales.dato, {}, puedeCrear)}
      />
    );
  });
}

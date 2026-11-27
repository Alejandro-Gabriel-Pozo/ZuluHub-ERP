import { pantallaDeOperacion } from "../../../../../pantallas/operacion";
import { cargarElMapaDeMesas } from "../../../../../servidor/salon";
import {
  armarElMapa,
  filtroDeLaDireccion,
} from "../../../../../ui/plantillas/salon/modelo-del-mapa";
import { PantallaDelSalon } from "../../../../../ui/plantillas/salon/PantallaDelSalon";
import { ErrorDelDetalle } from "../../../../../ui/patrones/ErrorDelDetalle";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/salon` (SAL-A; maqueta `salon.html`, aprobada el 09/11/2026): el mapa de mesas de la sucursal con la que se trabaja. La sucursal, la empresa y la persona las pone el servidor (nunca la dirección);
// el permiso (`mesas.ver`), la perilla `salon` y el módulo los decide la consulta. De la dirección solo se lee `filtro`, y solo si es uno de la lista cerrada: lo demás se descarta.
export default async function PaginaDelSalon({ searchParams }: PropsDePagina) {
  const params = await searchParams;
  const filtro = filtroDeLaDireccion(params["filtro"]);
  return pantallaDeOperacion({ titulo: "salon.texto.grupo_salon" }, async () => {
    const respuesta = await cargarElMapaDeMesas(filtro === null ? undefined : { filtro });
    return respuesta.ok ? (
      <PantallaDelSalon mapa={armarElMapa({}, respuesta.dato.mesas, filtro)} />
    ) : (
      <PantallaDelSalon mapa={null} error={<ErrorDelDetalle error={respuesta.error} />} />
    );
  });
}

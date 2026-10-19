import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { CabeceraDeMarca } from "../../../ui/componentes/CabeceraDeMarca";
import { EnlaceDeAccion } from "../../../ui/componentes/EnlaceDeAccion";
import { PantallaDeEstado } from "../../../ui/plantillas/sesion/PantallaDeEstado";
import { exigirPuerta } from "../../../servidor/pedido";

// El 404 de la aplicación: con la marca de ESTE host y la salida al inicio.
export default async function NoEncontradaEnApp() {
  const puerta = await exigirPuerta("APP");
  return (
    <>
      <CabeceraDeMarca nombre={puerta.marca.nombre} />
      <PantallaDeEstado
        titulo={texto({}, "estado.no_encontrado_titulo")}
        detalle={texto({}, "estado.no_encontrado_detalle")}
      >
        <EnlaceDeAccion href="/">{texto({}, "estado.volver_al_inicio")}</EnlaceDeAccion>
      </PantallaDeEstado>
    </>
  );
}

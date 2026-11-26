import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLaCocina } from "../../../../../../servidor/comandas";
import { puedeAdministrarImpresoras, puedeImprimir } from "../../../../../../servidor/modulos";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { armarLosTextosDeImprimir } from "../../../../../../ui/patrones/papel/textos-de-imprimir";
import { RUTA_DE_IMPRESORAS } from "../../../../../../ui/plantillas/salon/modelo-de-impresoras";
import { armarLaCocina } from "../../../../../../ui/plantillas/salon/modelo-de-la-cocina";
import { PantallaDeLaCocina } from "../../../../../../ui/plantillas/salon/PantallaDeLaCocina.cliente";
import {
  declararImpresionAccion,
  imprimirDocumentoAccion,
  papelDelDocumentoAccion,
  reimprimirDocumentoAccion,
} from "../../../acciones-de-salon";

// `/salon/comandas` (SAL-H; maqueta aprobada por el dueño el 25/11/2026): los envíos de la sucursal con la que se trabaja cuyo papel espera o falló, para imprimirlos desde la PC o tablet de la cocina. La empresa, la
// persona y la sucursal las pone el servidor (nunca la dirección); el permiso (`comandas.ver`), la perilla y el módulo los decide la consulta. «Imprimir» y «Reintentar» solo se ofrecen a quien puede imprimir
// (`impresiones.imprimir`: es una ayuda, el servidor decide) y «Configurar impresoras» solo a quien puede administrarlas.
export default async function PaginaDeLaCocina() {
  return pantallaDeOperacion({ titulo: "comandas.texto.cocina_comandas" }, async ({ contexto }) => {
    const respuesta = await cargarLaCocina(contexto);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const configurar = await puedeAdministrarImpresoras(contexto);
    return (
      <PantallaDeLaCocina
        cocina={armarLaCocina({}, respuesta.dato.envios)}
        textos={armarLosTextosDeImprimir()}
        acciones={{
          imprimir: imprimirDocumentoAccion,
          reimprimir: reimprimirDocumentoAccion,
          declarar: declararImpresionAccion,
          papel: papelDelDocumentoAccion,
        }}
        puedeImprimir={await puedeImprimir(contexto)}
        configurarImpresoras={
          configurar ? (
            <a href={RUTA_DE_IMPRESORAS}>
              {texto({}, "comandas.texto.imprimir_configurar_impresoras")}
            </a>
          ) : null
        }
      />
    );
  });
}

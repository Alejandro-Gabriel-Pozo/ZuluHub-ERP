import { errorDeCodigo } from "../../../../../../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { cargarElDeposito } from "../../../../../../../../servidor/depositos-de-stock";
import { puedeEnStock } from "../../../../../../../../servidor/ofertas-de-stock";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeEditarDeposito } from "../../../../../../../../ui/plantillas/stock/depositos/FormularioDeEditarDeposito.cliente";
import {
  RUTAS_DE_DEPOSITOS,
  textoDelUsoDeUnDeposito,
  USO_DE_VENTA,
} from "../../../../../../../../ui/plantillas/stock/depositos/modelo-de-depositos";
import { pestanasDeStock } from "../../../../../../../../ui/plantillas/stock/pestanas-de-stock";
import { PestanasDeStock } from "../../../../../../../../ui/plantillas/stock/PestanasDeStock";
import { editarDepositoAccion } from "../../../../../acciones-de-depositos";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/stock/depositos/[id]/editar`: editar un depósito de la sucursal elegida (maqueta `stock-depositos-gestion.html`, 25/11/2026): su nombre y si es «de venta»; el uso se ve y no se cambia. El
// identificador de la dirección es lo único que viene del navegador: un depósito que no es de la sucursal elegida o de la persona sale como el genérico. La acción lleva la versión que se vio:
// si otra persona lo cambió antes, el servidor rechaza. «Guardar» sale apagado sin `depositos.editar` (el servidor igual decide).
export default async function PaginaDeEditarDeposito({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "stock.pantalla.depositos" }, async ({ contexto }) => {
    const respuesta = await cargarElDeposito(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const deposito = respuesta.dato;
    const uso = textoDelUsoDeUnDeposito(deposito.uso, (clave) => texto({}, clave));
    if (uso === null) {
      return <ErrorDelDetalle error={errorDeCodigo("STOCK_ACCION_NO_PERMITIDA")} />;
    }
    return (
      <>
        <PestanasDeStock pestanas={pestanasDeStock("depositos")} />
        <FormularioDeEditarDeposito
          key={`${deposito.id}-${String(deposito.version)}`}
          accion={editarDepositoAccion.bind(null, deposito.id, deposito.version)}
          textos={{
            nombre: texto({}, "catalogo.dato.nombre"),
            uso: texto({}, "stock.deposito.uso"),
            deVenta: texto({}, "stock.deposito.de_venta"),
            guardar: texto({}, "catalogo.accion.guardar"),
            cancelar: texto({}, "catalogo.accion.cancelar"),
          }}
          actual={{
            nombre: deposito.nombre,
            uso,
            deVenta: deposito.deVenta,
            admiteDeVenta: deposito.uso === USO_DE_VENTA,
          }}
          hrefDeCancelar={RUTAS_DE_DEPOSITOS.lista}
          puedeGuardar={await puedeEnStock(contexto, "depositos.editar")}
        />
      </>
    );
  });
}

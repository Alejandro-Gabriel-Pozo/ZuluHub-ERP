import { randomUUID } from "node:crypto";
import type { ClaveAccion } from "../../../src/capacidades/modulos/catalogo";
import type { ClaveDeTexto } from "../../../src/capacidades/vocabulario/catalogo";
import { texto } from "../../../src/capacidades/vocabulario/vocabulario";
import {
  ajustarAccion,
  anularAccion,
  registrarEntradaAccion,
  registrarSalidaAccion,
  transferirAccion,
} from "../app/s/app/acciones-de-movimientos";
import { cargarLasOpcionesDeMovimiento } from "../servidor/movimientos-de-stock";
import { puedeEnStock } from "../servidor/ofertas-de-stock";
import { ErrorDelDetalle } from "../ui/patrones/ErrorDelDetalle";
import { FormularioDeMovimiento } from "../ui/plantillas/stock/movimientos/FormularioDeMovimiento.cliente";
import {
  opcionesDeArticulo,
  opcionesDeDeposito,
  opcionesDeMotivo,
  opcionesDeSentido,
  RUTAS_DE_MOVIMIENTOS,
  type TipoDeMovimiento,
} from "../ui/plantillas/stock/movimientos/modelo-de-formularios";
import { pestanasDeStock } from "../ui/plantillas/stock/pestanas-de-stock";
import { PestanasDeStock } from "../ui/plantillas/stock/PestanasDeStock";
import { pantallaDeOperacion } from "./operacion";

/** Cada tipo con su título, el permiso que lo habilita y su acción de servidor (la clave de idempotencia, y al anular el movimiento, se ligan con `bind`). */
const DEL_TIPO: Readonly<
  Record<TipoDeMovimiento, Readonly<{ titulo: ClaveDeTexto; permiso: ClaveAccion }>>
> = {
  ENTRADA: { titulo: "stock.accion.entrada", permiso: "stock.registrar_entrada" },
  SALIDA: { titulo: "stock.accion.salida", permiso: "stock.registrar_salida" },
  TRANSFERIR: { titulo: "stock.accion.transferir", permiso: "stock.transferir" },
  AJUSTAR: { titulo: "stock.accion.ajustar", permiso: "stock.ajustar" },
  ANULAR: { titulo: "stock.accion.anular", permiso: "stock.anular" },
};

const accionDe = (tipo: TipoDeMovimiento, movimientoId: string | null) => {
  const clave = randomUUID();
  switch (tipo) {
    case "ENTRADA":
      return registrarEntradaAccion.bind(null, clave);
    case "SALIDA":
      return registrarSalidaAccion.bind(null, clave);
    case "TRANSFERIR":
      return transferirAccion.bind(null, clave);
    case "AJUSTAR":
      return ajustarAccion.bind(null, clave);
    case "ANULAR":
      return anularAccion.bind(null, clave, movimientoId ?? "");
  }
};

/**
 * Una pantalla de movimiento de stock a mano (maqueta `stock.html`, 09/11/2026): las pestañas de Stock y el formulario del tipo, dentro del armazón de operación. La sucursal la fija el servidor; los depósitos y
 * artículos que se ofrecen son los que el servidor deja mover. La clave de idempotencia se genera una vez al abrir la página: repetir el envío (doble toque, red cortada) no duplica. «Registrar» sale apagado
 * sin el permiso (el servidor igual decide). Anular recibe el movimiento por la dirección: uno que no existe o no es anulable sale con el genérico al enviar.
 */
export function pantallaDeMovimiento(tipo: TipoDeMovimiento, movimientoId: string | null = null) {
  const { titulo, permiso } = DEL_TIPO[tipo];
  return pantallaDeOperacion({ titulo }, async ({ contexto }) => {
    const opciones = await cargarLasOpcionesDeMovimiento(contexto);
    if (!opciones.ok) return <ErrorDelDetalle error={opciones.error} />;
    const dato = opciones.dato;
    const textoDe = (clave: ClaveDeTexto) => texto({}, clave);
    return (
      <>
        <PestanasDeStock pestanas={pestanasDeStock("movimientos")} />
        <FormularioDeMovimiento
          tipo={tipo}
          accion={accionDe(tipo, movimientoId)}
          textos={{
            deposito: textoDe("stock.pantalla.depositos"),
            origen: textoDe("stock.accion.origen"),
            destino: textoDe("stock.accion.destino"),
            articulo: textoDe("stock.accion.articulo"),
            sentido: textoDe("stock.accion.ajustar"),
            cantidad: textoDe("stock.accion.cantidad"),
            motivo: textoDe("stock.accion.motivo"),
            costo: textoDe("stock.accion.costo_por_unidad"),
            opcional: textoDe("catalogo.campo.opcional"),
            lote: textoDe("lotes.lote.lote"),
            vence: textoDe("stock.lotes.vence"),
            detalle: textoDe("stock.accion.detalle"),
            enviar: textoDe(tipo === "ANULAR" ? "stock.accion.anular" : "stock.accion.registrar"),
            cancelar: textoDe("catalogo.accion.cancelar"),
          }}
          depositos={opcionesDeDeposito(dato.depositos, tipo)}
          articulos={opcionesDeArticulo(dato.articulos)}
          motivos={opcionesDeMotivo(
            tipo === "ENTRADA" ? dato.motivosDeEntrada : dato.motivosDeSalida,
            textoDe,
          )}
          sentidos={opcionesDeSentido(textoDe)}
          hrefDeCancelar={RUTAS_DE_MOVIMIENTOS.lista}
          puedeEnviar={await puedeEnStock(contexto, permiso)}
        />
      </>
    );
  });
}

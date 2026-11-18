import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLosDepositos } from "../../../../../../servidor/depositos-de-stock";
import { puedeEnStock } from "../../../../../../servidor/ofertas-de-stock";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import {
  armarLaListaDeDepositos,
  RUTAS_DE_DEPOSITOS,
} from "../../../../../../ui/plantillas/stock/depositos/modelo-de-depositos";
import { PantallaDeDepositos } from "../../../../../../ui/plantillas/stock/depositos/PantallaDeDepositos";
import { pestanasDeStock } from "../../../../../../ui/plantillas/stock/pestanas-de-stock";
import { PestanasDeStock } from "../../../../../../ui/plantillas/stock/PestanasDeStock";

// `/stock/depositos`: los depósitos de la sucursal elegida en el dispositivo (maqueta `stock.html`, 09/11/2026). Sin sucursal elegida no se asume «todas»: sale el genérico. Un depósito
// desactivado no se muestra (la maqueta no dibuja el estado ni cómo reactivarlo).
export default async function PaginaDeDepositos() {
  return pantallaDeOperacion({ titulo: "stock.pantalla.depositos" }, async ({ contexto }) => {
    const depositos = await cargarLosDepositos(contexto);
    if (!depositos.ok) return <ErrorDelDetalle error={depositos.error} />;
    return (
      <>
        <PestanasDeStock pestanas={pestanasDeStock("depositos")} />
        <PantallaDeDepositos
          filas={armarLaListaDeDepositos(depositos.dato.depositos, (clave) => texto({}, clave))}
          textos={{
            agregar: texto({}, "stock.deposito.agregar"),
            deVenta: texto({}, "stock.deposito.de_venta"),
          }}
          puedeAgregar={await puedeEnStock(contexto, "depositos.crear")}
          hrefDeAgregar={RUTAS_DE_DEPOSITOS.nuevo}
        />
      </>
    );
  });
}

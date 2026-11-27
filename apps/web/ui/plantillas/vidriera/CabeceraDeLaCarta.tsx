import type { VistaDeVidriera } from "../../../../../src/capacidades/experiencia/vidriera/vista";
import { PlacaDeLaCarta } from "./IdentidadDeLaCarta";
import estilos from "./PlantillaDeVidriera.module.css";

/** La cabecera de la carta: placa, rubro, nombre (el `h1`) y lugar. La usan la Lista y la portada del Libro. */
export function CabeceraDeLaCarta({ vista }: Readonly<{ vista: VistaDeVidriera }>) {
  return (
    <header className={estilos["cabecera"]}>
      <PlacaDeLaCarta identidad={vista.identidad} />
      <div className={estilos["titulos"]}>
        {vista.rubro === null ? null : <p className={estilos["rubro"]}>{vista.rubro}</p>}
        <h1 className={estilos["nombre"]}>{vista.nombre}</h1>
        {vista.lugar === null ? null : <p className={estilos["lugar"]}>{vista.lugar}</p>}
      </div>
    </header>
  );
}

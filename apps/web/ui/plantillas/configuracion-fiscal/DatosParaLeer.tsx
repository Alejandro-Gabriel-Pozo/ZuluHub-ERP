import estilos from "./DatosParaLeer.module.css";

/** Las filas de «rótulo y valor» que solo se leen (el CUIT de la empresa en el formulario de Datos fiscales, D-65). */
export function DatosParaLeer({
  filas,
}: Readonly<{ filas: readonly Readonly<{ rotulo: string; valor: string }>[] }>) {
  return (
    <dl className={estilos["datos"]}>
      {filas.map((fila) => (
        <div key={fila.rotulo} className={estilos["dato"]}>
          <dt className={estilos["rotulo"]}>{fila.rotulo}</dt>
          <dd className={estilos["valor"]}>{fila.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

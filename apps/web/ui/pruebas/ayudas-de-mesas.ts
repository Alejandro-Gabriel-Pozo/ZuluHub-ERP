import type { MedidasDelSalon } from "../plantillas/salon/modelo-del-plano";

/**
 * Las medidas del salón para las pruebas de componente, que no pueden importar el dominio (la UI no importa `src/modulos`). Previene el desfase con el servidor: `test/web/mesas-plano.test.ts`
 * falla si difieren de `medidasDelSalon()`.
 */
export const MEDIDAS_DE_PRUEBA: MedidasDelSalon = {
  columnas: 14,
  filas: 9,
  huellas: [
    { forma: "REDONDA", tamano: "CHICA", ancho: 2, alto: 2 },
    { forma: "REDONDA", tamano: "MEDIANA", ancho: 3, alto: 3 },
    { forma: "REDONDA", tamano: "GRANDE", ancho: 4, alto: 4 },
    { forma: "CUADRADA", tamano: "CHICA", ancho: 2, alto: 2 },
    { forma: "CUADRADA", tamano: "MEDIANA", ancho: 3, alto: 3 },
    { forma: "CUADRADA", tamano: "GRANDE", ancho: 4, alto: 4 },
    { forma: "LARGA", tamano: "CHICA", ancho: 3, alto: 2 },
    { forma: "LARGA", tamano: "MEDIANA", ancho: 4, alto: 2 },
    { forma: "LARGA", tamano: "GRANDE", ancho: 5, alto: 2 },
  ],
};

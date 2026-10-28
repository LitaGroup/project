import rabbitImage from '../../assets/lita-rabbit.png'
import aiSymbol from '../../assets/ai-symbol.svg'
import './rabbit-identity.css'

/** Existing project artwork with an original four-point AI identity symbol. */
export function RabbitIdentity({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`rabbit-identity ${className}`}>
      <img className="rabbit-identity__image" src={rabbitImage} alt="" draggable={false} />
      <img className="rabbit-identity__symbol" src={aiSymbol} alt="" draggable={false} />
    </span>
  )
}

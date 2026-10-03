import React from 'react';
import { Link } from 'react-router-dom';
import StarRating from './StarRating';
import PriceBlock from './PriceBlock';
import ProductImage from './ProductImage';
import { useCart } from '../context/CartContext';

export default function ProductCard({ product }) {
  const { addToCart } = useCart();

  return (
    <div className="card card-hover" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Link to={`/product/${product.slug}`} style={{ display: 'block', aspectRatio: '1/1', background: '#f6f7f9' }}>
        <ProductImage src={product.images?.[0]} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </Link>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <span style={{ fontSize: 12, color: '#6f7c88' }}>{product.brand}</span>
        <Link to={`/product/${product.slug}`}>
          <h3 style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>
            {product.name.length > 60 ? `${product.name.slice(0, 60)}…` : product.name}
          </h3>
        </Link>
        <StarRating rating={product.rating} reviewCount={product.reviewCount} />
        <PriceBlock price={product.price} mrp={product.mrp} discountPercent={product.discountPercent} />
        {product.stock === 0 ? (
          <span style={{ fontSize: 12, color: '#c0392b', fontWeight: 600 }}>Out of stock</span>
        ) : (
          <button
            className="btn btn-outline btn-sm"
            style={{ marginTop: 'auto' }}
            onClick={() => addToCart(product, 1, product.variants?.[0]?.options?.[0] || null)}
          >
            Add to Cart
          </button>
        )}
      </div>
    </div>
  );
}

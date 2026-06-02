from fastapi import APIRouter

from ..symbols import (
    SYMBOL_CODES, SYMBOL_DICTIONARY, boq_item_for_symbol, boq_mapping_for_symbol,
    prompt_guidance_for_symbol, renderer_shape_for_symbol, standard_legend,
)

router = APIRouter(tags=["symbols"])


@router.get("/symbols")
async def symbols():
    return {
        "symbols": [
            {
                "symbol": code,
                "label": item.label,
                "description": item.description,
                "category": item.category,
                "default_specification": item.default_specification,
                "unit": item.unit,
                "color": item.color,
                "prompt_guidance": prompt_guidance_for_symbol(code),
                "boq_mapping": boq_mapping_for_symbol(code),
                "renderer_shape": renderer_shape_for_symbol(code),
                "boq_template": boq_item_for_symbol(code, 1),
            }
            for code, item in SYMBOL_DICTIONARY.items()
        ],
        "codes": SYMBOL_CODES,
        "legend": standard_legend(SYMBOL_CODES),
    }

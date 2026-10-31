import { idSchema } from '@inkline/shared';
import { apiError, authorizeApi } from '@/server/auth/api';
import { deleteComment } from '@/server/engagement/comments';
import { limitUser } from '@/server/engagement/limits';

/** DELETE: you can delete your own comment. Anyone else gets 403. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ commentId: string }> },
) {
  const auth = await authorizeApi();
  if ('response' in auth) return auth.response;
  {
    const limited = await limitUser(auth.user.id);
    if (limited) return limited;
  }
  const id = idSchema.safeParse((await context.params).commentId);
  if (!id.success) return apiError(400, 'invalid_request');
  const result = await deleteComment(id.data, { id: auth.user.id, role: auth.user.role });
  if (result === 'not_found') return apiError(404, 'not_found');
  if (result === 'forbidden') return apiError(403, 'forbidden');
  return new Response(null, { status: 204 });
}

/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */

import { _ } from 'underscore'
import { chai } from 'meteor/practicalmeteor:chai'
const expect = chai.expect

import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { SimpleSchema } from 'meteor/aldeed:simple-schema'

import { DenormalizedViews, ERROR_IDENTIFIERT_EXISTS, ERROR_SOURCE_AND_TARGET_COLLECTIONS_NEED_TO_BE_DIFFERENT, ERROR_SYNC_NEEDS_TO_HAVE_CONTENT, ERROR_SYNC_ALREADY_EXISTS_FOR_SOURCE_TARGET_COLLECTIONS, ERROR_REFRESH_BY_COLLECTION_CAN_NOT_BE_SET_TO_SOURCE_COLLECTION, ERROR_REFRESH_BY_COLLECTION_NEEDS_TO_BE_ASSIGNED_TO_AN_EXISTING_ID } from 'meteor/denormalized-views'

DenormalizedViews.Debug = true

// FIXTURES
const Authors =  new Mongo.Collection('authors')
const Comments = new Mongo.Collection('comments')
const Posts = new Mongo.Collection('posts')
const PostsDenormalizedView = new Mongo.Collection('postsdenormalizedview')
const HookTestCollection = new Mongo.Collection('hooktestcollection')  // needed for testcase
Authors.attachSchema(new SimpleSchema({
  name: {
    type: String,
  },
}))
Comments.attachSchema(new SimpleSchema({
  text: {
    type: String,
  },
}))
Posts.attachSchema(new SimpleSchema({
  text: {
    type: String,
  },
  additionalText: {
    type: String,
  },
  authorId: {
    type: String,
  },
  commentIds: {
    type: [String],
    optional: true,
  },
}))

// Identifier allow you to add MULTIPLE view to one single collection
const DENORMALIZED_POST_COLLECTION = 'DENORMALIZED_POST_COLLECTION'
DenormalizedViews.addSyncronisation({
  identifier: DENORMALIZED_POST_COLLECTION,
  sourceCollection: Posts,
  targetCollection: PostsDenormalizedView,
  sync: {
    commentsCache: (post, userId) => {
      const comments = []
      for (const commentId of post.commentIds) {
        const comment = Comments.findOne(commentId)
        comments.push(comment)
      }
      return comments
    },
    authorCache: (post, userId) => {
      return Authors.findOne(post.authorId)
    },
  },
  postSync: {
    wholeText: (post, userId) => {
      let authorText = ''
      if (post.authorCache) {
        authorText = post.authorCache.name
      }
      return `${post.text}, ${_.pluck(post.commentsCache, 'text').join(', ')}, ${authorText}`
    },
    numberOfComments: (post, userId) => {
      return post.commentsCache.length
    },
  },
})

DenormalizedViews.refreshByCollection({
  identifier: DENORMALIZED_POST_COLLECTION,
  triggerCollection: Authors,
  refreshIds: (author, userId) => {
    // return _id-array of posts that should be updated
    // return false, an empty array or undefined to NOT sync
    const posts = Posts.find({ authorId: author._id }).fetch()
    return _.pluck(posts, '_id')
  },
})

const setupFixtures = () => {
  Authors.remove({})
  Comments.remove({})
  Posts.remove({})
  PostsDenormalizedView.remove({})

  const authorId1 = Authors.insert({
    name: 'author 1',
  })
  const authorId2 = Authors.insert({
    name: 'author 2',
  })
  const authorId3 = Authors.insert({
    name: 'author 3',
  })
  const commentId1 = Comments.insert({
    text: 'comment 1',
  })
  const commentId2 = Comments.insert({
    text: 'comment 2',
  })
  const commentId3 = Comments.insert({
    text: 'comment 3',
  })
  const commentId4 = Comments.insert({
    text: 'comment 4',
  })
  const postId1 = Posts.insert({
    text: 'post 1',
    additionalText: 'additionalText post 1',
    authorId: authorId1,
    commentIds: [
      commentId1,
    ],
  })
  const postId2 = Posts.insert({
    text: 'post 2',
    additionalText: 'additionalText post 2',
    authorId: authorId1,
    commentIds: [
      commentId2,
    ],
  })
  const postId3 = Posts.insert({
    text: 'post 3',
    additionalText: 'additionalText post 3',
    authorId: authorId2,
    commentIds: [
    ],
  })
  const postId4 = Posts.insert({
    text: 'post 4',
    additionalText: 'additionalText post 4',
    authorId: authorId2,
    commentIds: [
      commentId4,
    ],
  })

  return {
    commentId1,
    commentId2,
    commentId3,
    commentId4,
    authorId1,
    authorId2,
    authorId3,
    postId1,
    postId2,
    postId3,
    postId4,
  }
}

const validateFixtures = () => {
  expect(Authors.find().count()).to.equal(3)
  expect(Comments.find().count()).to.equal(4)
  expect(Posts.find().count()).to.equal(4)
  expect(PostsDenormalizedView.find().count()).to.equal(4)
}

// TESTS
if (Meteor.isServer) {
  describe('Foundation', function () {
    it('CollectionHooks-package allows us to instanciate multiple hook-functions. All hooks defined hook-functions will be run.', function () {
      // define 2 hooks to test if they are both run
      HookTestCollection.after.insert(function (userId, doc) {
        HookTestCollection.update(doc._id.insertedIds[0], { $set: { insertHook1: 'insertHook1 was here' } })
      })
      HookTestCollection.after.insert(function (userId, doc) {
        HookTestCollection.update(doc._id.insertedIds[0], { $set: { insertHook2: 'insertHook2 was here' } })
      })
      // do an insert, to trigger the hooks
      const docId = HookTestCollection.insert({
        test: 'test insert'
      })
      // check
      const doc = HookTestCollection.findOne(docId)
      expect(doc.test).to.equal('test insert')
      expect(doc.insertHook1).to.equal('insertHook1 was here')
      expect(doc.insertHook2).to.equal('insertHook2 was here')
    })
  })
  describe('DenormalizedViews', function () {
    beforeEach(() => {
      Authors.remove({})
      Comments.remove({})
      Posts.remove({})
      PostsDenormalizedView.remove({})
    })

    // CONFIGURATION
    // INSERT
    // UPDATE
    // REMOVE
    it('.addSyncronisation does validate options correctly', function () {
      expect(() => {
        DenormalizedViews.addSyncronisation({
          identifier: DENORMALIZED_POST_COLLECTION,  // duplicate id
          sourceCollection: Posts,
          targetCollection: PostsDenormalizedView,
          sync: { },
        })
      }).to.throw(ERROR_IDENTIFIERT_EXISTS)

      expect(() => {
        DenormalizedViews.addSyncronisation({
          identifier: 'unique',
          sourceCollection: Posts,  // same collection
          targetCollection: Posts,  // same collection
          sync: { },
        })
      }).to.throw(ERROR_SOURCE_AND_TARGET_COLLECTIONS_NEED_TO_BE_DIFFERENT)

      expect(() => {
        DenormalizedViews.addSyncronisation({
          identifier: 'unique',
          sourceCollection: Posts,
          targetCollection: PostsDenormalizedView,
          sync: {
            // NO content
          },
        })
      }).to.throw(ERROR_SYNC_NEEDS_TO_HAVE_CONTENT)

      expect(() => {
        DenormalizedViews.addSyncronisation({
          identifier: 'unique but combination already exists',
          sourceCollection: Posts,
          targetCollection: PostsDenormalizedView,
          sync: {
            authorCache: (post) => {
              return Authors.findOne(post.authorId)
            },
          },
        })
      }).to.throw(ERROR_SYNC_ALREADY_EXISTS_FOR_SOURCE_TARGET_COLLECTIONS)
    })

    it('.addSyncronisation works as expected on INSERTS on targetCollection', function () {
      const fixtures = setupFixtures()  // inserts happen here
      validateFixtures()

      const postDenormalized1 = PostsDenormalizedView.findOne(fixtures.postId1)
      expect(postDenormalized1._id).to.equal(fixtures.postId1)
      expect(postDenormalized1.text).to.equal('post 1')
      expect(postDenormalized1.commentsCache.length).to.equal(1)
      expect(postDenormalized1.commentsCache[0].text).to.equal('comment 1')
      expect(postDenormalized1.authorCache.name).to.equal('author 1')
      expect(postDenormalized1.wholeText).to.equal('post 1, comment 1, author 1')
      expect(postDenormalized1.numberOfComments).to.equal(1)
    })
    it('.addSyncronisation works as expected on UPDATES on targetCollection', function () {
      const fixtures = setupFixtures()
      validateFixtures()

      const updates = Posts.update(fixtures.postId1, { $set: { text: 'post 1 newtext', commentIds: [fixtures.commentId2, fixtures.commentId3], authorId: fixtures.authorId2 } })
      expect(updates).to.equal(1)
      expect(PostsDenormalizedView.find().count()).to.equal(4)
      const postDenormalized1 = PostsDenormalizedView.findOne(fixtures.postId1)
      expect(postDenormalized1.text).to.equal('post 1 newtext')
      expect(postDenormalized1.commentsCache.length).to.equal(2)
      expect(postDenormalized1.commentsCache[0].text).to.equal('comment 2')
      expect(postDenormalized1.commentsCache[1].text).to.equal('comment 3')
      expect(postDenormalized1.authorCache.name).to.equal('author 2')
      expect(postDenormalized1.wholeText).to.equal('post 1 newtext, comment 2, comment 3, author 2')
      expect(postDenormalized1.numberOfComments).to.equal(2)
    })
    it('.addSyncronisation works as expected on REMOVES on targetCollection', function () {
      const fixtures = setupFixtures()
      validateFixtures()

      const updates = Posts.remove(fixtures.postId1)
      expect(updates).to.equal(1)
      const postDenormalized1 = PostsDenormalizedView.findOne(fixtures.postId1)
      expect(postDenormalized1).to.be.undefined
    })

    it('.refreshByCollection correctly validated options', function () {
      expect(() => {
        DenormalizedViews.refreshByCollection({
          identifier: 'unique does NOT exist yet',
          triggerCollection: Authors,  // wrong collection!!
          refreshIds: () => {},
        })
      }).to.throw(ERROR_REFRESH_BY_COLLECTION_NEEDS_TO_BE_ASSIGNED_TO_AN_EXISTING_ID)
      expect(() => {
        DenormalizedViews.refreshByCollection({
          identifier: DENORMALIZED_POST_COLLECTION,
          triggerCollection: Posts,  // wrong collection!!
          refreshIds: () => {},
        })
      }).to.throw(ERROR_REFRESH_BY_COLLECTION_CAN_NOT_BE_SET_TO_SOURCE_COLLECTION)
    })

    it('.refreshByCollection works as expected on updates on triggerCollection', function () {
      // NOTE: refreshByCollection() is set up above on Authors collection
      // a simple update on author should refresh the "view"-Collection
      const fixtures = setupFixtures()
      validateFixtures()

      // UPDATE
      Authors.update(fixtures.authorId1, { $set: { name: 'author 1 name NEW' } })
      const postDenormalized1 = PostsDenormalizedView.findOne(fixtures.postId1)
      expect(postDenormalized1.authorCache.name).to.equal('author 1 name NEW')
      expect(postDenormalized1.wholeText).to.equal('post 1, comment 1, author 1 name NEW')
    })

    it('.refreshByCollection works as expected on removes on triggerCollection', function () {
      const fixtures = setupFixtures()
      validateFixtures()

      // REMOVE
      Authors.remove(fixtures.authorId1)
      const postDenormalized1 = PostsDenormalizedView.findOne(fixtures.postId1)
      expect(postDenormalized1.authorCache).to.be.undefined
      expect(postDenormalized1.wholeText).to.equal('post 1, comment 1, ')
    })

    xit('.refreshByCollection works as expected on inserts on triggerCollection', function () {
      // INSERT
      // TODO: write test for useCases where this would be useful
    })

    it('.refreshManually works as expected', function () {
      const fixtures = setupFixtures()
      validateFixtures()

      // NOTE: in our test-setting Comments are NOT automatically synced
      // to "view"-collection via ``refreshByCollection``,
      // so that we can test ``refreshManually()``
      Comments.update(fixtures.commentId1, { $set: { text: 'comment 1 new text' } })
      DenormalizedViews.refreshManually({
        identifier: DENORMALIZED_POST_COLLECTION,
        refreshIds: [fixtures.postId1]
      })
      const postDenormalized1 = PostsDenormalizedView.findOne(fixtures.postId1)
      expect(postDenormalized1.text).to.equal('post 1')
      expect(postDenormalized1.commentsCache.length).to.equal(1)
      expect(postDenormalized1.commentsCache[0].text).to.equal('comment 1 new text')
      expect(postDenormalized1.authorCache.name).to.equal('author 1')
      expect(postDenormalized1.wholeText).to.equal('post 1, comment 1 new text, author 1')
      expect(postDenormalized1.numberOfComments).to.equal(1)
    })

    it('.refreshAll works as expected', function () {
      const fixtures = setupFixtures()
      validateFixtures()

      // NOTE: comments are NOT synced automatically, so in this test
      // we update their text and then check if the "view"-collection
      // contains the right data after ``refreshAll()``
      Comments.update(fixtures.commentId1, { $set: { text: 'comment 1 new text' } })
      Comments.update(fixtures.commentId2, { $set: { text: 'comment 2 new text' } })
      Comments.update(fixtures.commentId3, { $set: { text: 'comment 3 new text' } })

      DenormalizedViews.refreshAll(DENORMALIZED_POST_COLLECTION)

      const postDenormalized1 = PostsDenormalizedView.findOne(fixtures.postId1)
      const postDenormalized2 = PostsDenormalizedView.findOne(fixtures.postId2)
      const postDenormalized3 = PostsDenormalizedView.findOne(fixtures.postId3)
      const postDenormalized4 = PostsDenormalizedView.findOne(fixtures.postId4)

      expect(postDenormalized1.commentsCache.length).to.equal(1)
      expect(postDenormalized1.commentsCache[0].text).to.equal('comment 1 new text')
      expect(postDenormalized2.commentsCache.length).to.equal(1)
      expect(postDenormalized2.commentsCache[0].text).to.equal('comment 2 new text')
      expect(postDenormalized3.commentsCache.length).to.equal(0)
      expect(postDenormalized4.commentsCache.length).to.equal(1)
      expect(postDenormalized4.commentsCache[0].text).to.equal('comment 4 new text')
    })

    it('.remove works as expected', function () {
      setupFixtures()
      validateFixtures()

      DenormalizedViews.remove(DENORMALIZED_POST_COLLECTION)
      setupFixtures()  // run inserts
      expect(PostsDenormalizedView.find().count()).to.equal(0)
    })
  })
}
